#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreVideo/CoreVideo.h>
#import <unistd.h>
#import "capture-macos.h"

// All asynchronous callbacks remain native. The library is pinned by Electron's
// main thread until process exit, including callbacks completing after close.
@interface MewMacCapture : NSObject <SCStreamOutput, SCStreamDelegate> {
@public
    dispatch_queue_t queue;
    SCStream *stream;
    CVPixelBufferRef latest;
    uint8_t *previous;
    BOOL closed, failed, hasFrame, starting;
    uint32_t width, height, display;
    CGRect bounds;
    size_t displayWidth, displayHeight;
    double rotation, lastHealth, lastCursor;
    id activity;
    // Only the main queue accesses the cursor image cache.
    NSData *cursorImage;
    uint32_t cursorId, cursorWidth, cursorHeight, hotX, hotY;
}
- (void)start;
- (void)stop;
- (void)stopStream;
@end

@implementation MewMacCapture
- (void)start {
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES
        completionHandler:^(SCShareableContent *content, NSError *error) {
        dispatch_async(self->queue, ^{
            if (self->closed) return;
            SCDisplay *selected = nil;
            for (SCDisplay *candidate in content.displays) if (candidate.displayID == self->display) { selected = candidate; break; }
            if (error || !selected) { self->failed = YES; return; }
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            config.width = self->width; config.height = self->height;
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            config.showsCursor = NO;
            config.minimumFrameInterval = CMTimeMake(1, 60);
            config.queueDepth = 3;
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:selected excludingWindows:@[]];
            self->stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:self];
            NSError *outputError = nil;
            if (![self->stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:self->queue error:&outputError]) {
                self->failed = YES; return;
            }
            self->starting = YES;
            [self->stream startCaptureWithCompletionHandler:^(NSError *startError) {
                dispatch_async(self->queue, ^{
                    self->starting = NO;
                    if (startError) self->failed = YES;
                    // A close during asynchronous startup must stop the stream
                    // after startup completes, not race a stop against a start.
                    if (self->closed) [self stopStream];
                });
            }];
        });
    }];
}
- (void)stream:(SCStream *)source didStopWithError:(NSError *)error {
    (void)source; (void)error;
    dispatch_async(queue, ^{ self->failed = YES; });
}
- (void)stream:(SCStream *)source didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    (void)source;
    if (closed || failed || type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
    if (!attachments || !CFArrayGetCount(attachments)) { failed = YES; return; }
    NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(attachments, 0);
    NSNumber *status = info[SCStreamFrameInfoStatus];
    if (!status) { failed = YES; return; }
    if (status.integerValue == SCFrameStatusIdle) return;
    CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sample);
    if (status.integerValue == SCFrameStatusStarted && !pixels) return;
    // Blank/suspended/stopped cannot be mistaken for a healthy static desktop.
    if (status.integerValue != SCFrameStatusComplete && status.integerValue != SCFrameStatusStarted) { failed = YES; return; }
    if (!pixels || CVPixelBufferGetPixelFormatType(pixels) != kCVPixelFormatType_32BGRA ||
        CVPixelBufferGetWidth(pixels) != width || CVPixelBufferGetHeight(pixels) != height) { failed = YES; return; }
    CVPixelBufferRetain(pixels);
    if (latest) CVPixelBufferRelease(latest);
    latest = pixels; // Keep only the newest unconsumed surface, never a frame queue.
}
- (void)stop {
    dispatch_sync(queue, ^{
        self->closed = YES;
        if (!self->starting) [self stopStream];
        if (self->latest) { CVPixelBufferRelease(self->latest); self->latest = NULL; }
        if (self->activity) { [NSProcessInfo.processInfo endActivity:self->activity]; self->activity = nil; }
    });
}
- (void)stopStream {
    SCStream *old = stream; stream = nil;
    if (old) [old stopCaptureWithCompletionHandler:^(NSError *error) {
        (void)error;
        [old removeStreamOutput:self type:SCStreamOutputTypeScreen error:NULL];
    }];
}
- (void)dealloc {
    if (latest) CVPixelBufferRelease(latest);
    free(previous);
}
@end

uint32_t mew_capture_abi(void) { return 1; }

void *mew_capture_create(uint32_t display, uint32_t width, uint32_t height,
                        double x, double y, double logicalWidth, double logicalHeight) {
    @autoreleasepool {
        if (width < 2 || height < 2 || width > 1920 || height > 1080 ||
            !isfinite(x) || !isfinite(y) || !isfinite(logicalWidth) || !isfinite(logicalHeight) ||
            logicalWidth < 1 || logicalHeight < 1 || !CGDisplayIsActive(display) || !CGPreflightScreenCaptureAccess()) return NULL;
        CGRect expected = CGRectMake(x, y, logicalWidth, logicalHeight), actual = CGDisplayBounds(display);
        if (!CGRectEqualToRect(expected, actual)) return NULL;
        MewMacCapture *capture = [MewMacCapture new];
        capture->queue = dispatch_queue_create("mew.desktop.capture", DISPATCH_QUEUE_SERIAL);
        capture->display = display; capture->width = width; capture->height = height; capture->bounds = actual;
        capture->displayWidth = CGDisplayPixelsWide(display); capture->displayHeight = CGDisplayPixelsHigh(display);
        capture->rotation = CGDisplayRotation(display);
        capture->previous = calloc((size_t)width * height, 4);
        if (!capture->previous) return NULL;
        capture->activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiated | NSActivityIdleDisplaySleepDisabled
                                                                       reason:@"Mew remote desktop"];
        [capture start];
        return (__bridge_retained void *)capture;
    }
}

int mew_capture_read(void *handle, uint8_t *pixels, size_t capacity) {
    @autoreleasepool {
        MewMacCapture *capture = (__bridge MewMacCapture *)handle;
        if (!capture || !pixels || capacity < (size_t)capture->width * capture->height * 4) return -1;
        __block int result = 0;
        dispatch_sync(capture->queue, ^{
            double now = NSProcessInfo.processInfo.systemUptime;
            if (now - capture->lastHealth >= .5) {
                capture->lastHealth = now;
                NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
                BOOL active = [session[(__bridge NSString *)kCGSessionOnConsoleKey] boolValue] &&
                    [session[(__bridge NSString *)kCGSessionUserIDKey] unsignedIntValue] == getuid();
                if (!active || !CGPreflightScreenCaptureAccess() || !CGDisplayIsActive(capture->display) ||
                    CGDisplayIsAsleep(capture->display) || !CGRectEqualToRect(CGDisplayBounds(capture->display), capture->bounds) ||
                    CGDisplayPixelsWide(capture->display) != capture->displayWidth || CGDisplayPixelsHigh(capture->display) != capture->displayHeight ||
                    CGDisplayRotation(capture->display) != capture->rotation) capture->failed = YES;
            }
            if (capture->closed || capture->failed) { result = -1; return; }
            CVPixelBufferRef frame = capture->latest;
            if (!frame) return;
            capture->latest = NULL;
            if (CVPixelBufferLockBaseAddress(frame, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) {
                CVPixelBufferRelease(frame); capture->failed = YES; result = -1; return;
            }
            const uint8_t *source = CVPixelBufferGetBaseAddress(frame);
            size_t stride = CVPixelBufferGetBytesPerRow(frame), row = capture->width * 4;
            if (!source || stride < row) { capture->failed = YES; result = -1; }
            else {
                BOOL changed = !capture->hasFrame;
                for (uint32_t y = 0; !changed && y < capture->height; y++)
                    changed = memcmp(source + y * stride, capture->previous + y * row, row) != 0;
                if (changed) {
                    for (uint32_t y = 0; y < capture->height; y++) memcpy(capture->previous + y * row, source + y * stride, row);
                    memcpy(pixels, capture->previous, row * capture->height);
                    capture->hasFrame = YES; result = 1;
                }
            }
            CVPixelBufferUnlockBaseAddress(frame, kCVPixelBufferLock_ReadOnly);
            CVPixelBufferRelease(frame);
        });
        return result;
    }
}

int mew_capture_cursor(void *handle, MewMacCursor *out, uint8_t *pixels, size_t capacity) {
    @autoreleasepool {
        MewMacCapture *capture = (__bridge MewMacCapture *)handle;
        if (!capture || !out || !pixels || capacity < 128 * 128 * 4) return -1;
        CGEventRef event = CGEventCreate(NULL);
        if (!event) return -1;
        CGPoint point = CGEventGetLocation(event); CFRelease(event);
        out->x = (point.x - capture->bounds.origin.x) / capture->bounds.size.width;
        out->y = (point.y - capture->bounds.origin.y) / capture->bounds.size.height;
        // Deprecated public APIs have no equivalent for another app's cursor.
        // Do not substitute currentCursor (which reads only our hidden app).
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        out->visible = CGCursorIsVisible() && CGRectContainsPoint(capture->bounds, point);
        __block int result = 0;
        dispatch_sync(dispatch_get_main_queue(), ^{
            @autoreleasepool {
                double now = NSProcessInfo.processInfo.systemUptime;
                out->changed = 0;
                if (!capture->cursorImage || now - capture->lastCursor >= 1.0 / 30) {
                    capture->lastCursor = now;
                    NSCursor *cursor = NSCursor.currentSystemCursor ?: NSCursor.arrowCursor;
                    NSImage *image = cursor.image;
                    NSSize size = image.size;
                    if (!isfinite(size.width) || !isfinite(size.height) || size.width < 1 || size.height < 1) { result = -1; return; }
                    double scale = fmin(1, fmin(128 / size.width, 128 / size.height));
                    uint32_t w = MIN(128, MAX(1, (uint32_t)ceil(size.width * scale)));
                    uint32_t h = MIN(128, MAX(1, (uint32_t)ceil(size.height * scale)));
                    NSRect rect = NSMakeRect(0, 0, size.width, size.height);
                    CGImageRef cgImage = [image CGImageForProposedRect:&rect context:nil hints:nil];
                    if (!cgImage) { result = -1; return; }
                    NSMutableData *data = [NSMutableData dataWithLength:w * h * 4];
                    CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
                    if (!data || !color) { if (color) CGColorSpaceRelease(color); result = -1; return; }
                    CGContextRef context = CGBitmapContextCreate(data.mutableBytes, w, h, 8, w * 4, color,
                                                                kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
                    CGColorSpaceRelease(color);
                    if (!context) { result = -1; return; }
                    CGContextDrawImage(context, CGRectMake(0, 0, w, h), cgImage);
                    CGContextRelease(context);
                    uint32_t hx = (uint32_t)fmax(0, fmin(w - 1, round(cursor.hotSpot.x * scale)));
                    uint32_t hy = (uint32_t)fmax(0, fmin(h - 1, round(cursor.hotSpot.y * scale)));
                    if (![data isEqualToData:capture->cursorImage] || w != capture->cursorWidth || h != capture->cursorHeight ||
                        hx != capture->hotX || hy != capture->hotY) {
                        capture->cursorImage = data; capture->cursorId++;
                        capture->cursorWidth = w; capture->cursorHeight = h; capture->hotX = hx; capture->hotY = hy;
                        out->changed = 1;
                    }
                }
                out->shape_id = capture->cursorId; out->width = capture->cursorWidth; out->height = capture->cursorHeight;
                out->hot_x = capture->hotX; out->hot_y = capture->hotY;
                if (out->changed) memcpy(pixels, capture->cursorImage.bytes, capture->cursorImage.length);
            }
        });
#pragma clang diagnostic pop
        return result;
    }
}

void mew_capture_close(void *handle) {
    @autoreleasepool {
        if (handle) { MewMacCapture *capture = CFBridgingRelease(handle); [capture stop]; }
    }
}
