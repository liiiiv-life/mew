#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <VideoToolbox/VideoToolbox.h>
#import <UserNotifications/UserNotifications.h>
#import <Metal/Metal.h>
#import <stdatomic.h>
#import <unistd.h>
#import "gpu-posix.h"

@interface MewGpuMac : NSObject <SCStreamOutput, SCStreamDelegate> {
@public
    dispatch_queue_t queue;
    dispatch_group_t stopped;
    SCStream *stream;
    VTCompressionSessionRef encoder;
    CVPixelBufferRef latest;
    CMTime latestTime, firstTime, submittedTime;
    NSMutableData *encoded;
    MewGpuFrame metadata;
    MewGpuScreen screen;
    CGRect bounds;
    size_t physicalWidth, physicalHeight;
    double rotation, health, submittedAt;
    int width, height, fps;
    BOOL closed, failed, starting, busy, forceKey, fresh;
    id activity;
}
- (BOOL)stop;
- (void)stopStream;
@end

static void output(void *ref, void *source, OSStatus status, VTEncodeInfoFlags flags, CMSampleBufferRef sample) {
    (void)source; (void)flags;
    MewGpuMac *capture = (__bridge MewGpuMac *)ref;
    if (sample) CFRetain(sample);
    dispatch_async(capture->queue, ^{
        capture->busy = NO;
        if (capture->closed) { if (sample) CFRelease(sample); return; }
        if (status || !sample || !CMSampleBufferDataIsReady(sample)) { capture->failed = YES; if (sample) CFRelease(sample); return; }
        CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
        CFDictionaryRef info = attachments && CFArrayGetCount(attachments) ? CFArrayGetValueAtIndex(attachments, 0) : NULL;
        BOOL key = !info || !CFEqual(CFDictionaryGetValue(info, kCMSampleAttachmentKey_NotSync) ?: kCFBooleanFalse, kCFBooleanTrue);
        CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sample);
        int header = 0;
        const uint8_t *parameter = NULL; size_t size = 0, count = 0;
        NSMutableData *data = [NSMutableData data];
        static const uint8_t prefix[4] = {0, 0, 0, 1};
        OSStatus result = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, 0, &parameter, &size, &count, &header);
        if (result || header < 1 || header > 4) capture->failed = YES;
        if (key && !capture->failed) {
            for (size_t i = 0; i < count; i++) {
                if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, i, &parameter, &size, NULL, NULL)) { capture->failed = YES; break; }
                [data appendBytes:prefix length:4]; [data appendBytes:parameter length:size];
            }
        }
        CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
        size_t length = block ? CMBlockBufferGetDataLength(block) : 0;
        if (!length || length > 4 * 1024 * 1024) capture->failed = YES;
        NSMutableData *avcc = [NSMutableData dataWithLength:capture->failed ? 0 : length];
        if (!capture->failed && CMBlockBufferCopyDataBytes(block, 0, length, avcc.mutableBytes)) capture->failed = YES;
        const uint8_t *bytes = avcc.bytes;
        for (size_t offset = 0; !capture->failed && offset < length;) {
            if (offset + (size_t)header > length) { capture->failed = YES; break; }
            uint32_t nal = 0;
            for (int i = 0; i < header; i++) nal = (nal << 8) | bytes[offset++];
            if (!nal || nal > length - offset) { capture->failed = YES; break; }
            [data appendBytes:prefix length:4]; [data appendBytes:bytes + offset length:nal]; offset += nal;
        }
        if (data.length > 4 * 1024 * 1024 || capture->encoded) capture->failed = YES;
        if (!capture->failed) {
            capture->encoded = data;
            capture->metadata = (MewGpuFrame){(int32_t)data.length, capture->width, capture->height, key,
                CMTimeConvertScale(CMSampleBufferGetPresentationTimeStamp(sample), 1000000, kCMTimeRoundingMethod_Default).value};
        }
        CFRelease(sample);
    });
}

@implementation MewGpuMac
- (void)stream:(SCStream *)source didStopWithError:(NSError *)error {
    (void)source; (void)error; dispatch_async(queue, ^{ self->failed = YES; });
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
    CVPixelBufferRef surface = CMSampleBufferGetImageBuffer(sample);
    if (status.integerValue == SCFrameStatusStarted && !surface) return;
    if ((status.integerValue != SCFrameStatusComplete && status.integerValue != SCFrameStatusStarted) || !surface ||
        CVPixelBufferGetPixelFormatType(surface) != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange ||
        CVPixelBufferGetWidth(surface) != (size_t)width || CVPixelBufferGetHeight(surface) != (size_t)height) { failed = YES; return; }
    if (latest) CVPixelBufferRelease(latest);
    latest = CVPixelBufferRetain(surface); latestTime = CMSampleBufferGetPresentationTimeStamp(sample); fresh = YES;
}
- (void)stopStream {
    SCStream *old = stream; stream = nil;
    if (old) [old stopCaptureWithCompletionHandler:^(NSError *error) {
        (void)error; [old removeStreamOutput:self type:SCStreamOutputTypeScreen error:NULL];
        dispatch_group_leave(self->stopped);
    }];
}
- (BOOL)stop {
    dispatch_sync(queue, ^{
        self->closed = YES;
        if (!self->starting) [self stopStream];
        if (self->encoder) { VTCompressionSessionInvalidate(self->encoder); CFRelease(self->encoder); self->encoder = NULL; }
        if (self->latest) { CVPixelBufferRelease(self->latest); self->latest = NULL; }
        self->encoded = nil;
        if (self->activity) { [NSProcessInfo.processInfo endActivity:self->activity]; self->activity = nil; }
    });
    return dispatch_group_wait(stopped, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0;
}
- (void)dealloc { if (latest) CVPixelBufferRelease(latest); }
@end

typedef struct { void *capture, *device; } MacHost;
int mew_gpu_abi(void) { return 2; }
int mew_gpu_allowed(void) {
    @autoreleasepool {
        NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
        return getuid() != 0 && [session[(__bridge NSString *)kCGSessionOnConsoleKey] boolValue] &&
            [session[(__bridge NSString *)kCGSessionUserIDKey] unsignedIntValue] == getuid() &&
            ![session[@"CGSSessionScreenIsLocked"] boolValue] &&
            CGPreflightScreenCaptureAccess() && AXIsProcessTrusted();
    }
}
const char *mew_gpu_error(void *p) { (void)p; return "Mac 화면 공유·하드웨어 H.264가 종료됐습니다. Mew Desktop의 화면 기록·손쉬운 사용, 활성 화면·GPU를 확인해 주세요."; }
void *mew_gpu_create(void) {
    @autoreleasepool {
        id<MTLDevice> device = MTLCreateSystemDefaultDevice(); if (!device) return NULL;
        MacHost *host = calloc(1, sizeof(MacHost)); if (!host) return NULL;
        host->device = (__bridge_retained void *)device; return host;
    }
}
int mew_gpu_screens(void *p, MewGpuScreen *out, int capacity) {
    (void)p; if (!out || capacity < 1 || capacity > 32) return -1;
    CGDirectDisplayID displays[32]; uint32_t count = 0;
    if (CGGetActiveDisplayList((uint32_t)capacity, displays, &count)) return -1;
    for (uint32_t i = 0; i < count; i++) {
        CGRect rect = CGDisplayBounds(displays[i]);
        out[i] = (MewGpuScreen){(int32_t)displays[i], (int32_t)rect.origin.x, (int32_t)rect.origin.y, (int32_t)rect.size.width, (int32_t)rect.size.height, 0};
    }
    return (int)count;
}
int mew_gpu_stop(void *p) {
    MacHost *host = p; if (!host) return -1; if (!host->capture) return 0;
    @autoreleasepool {
        MewGpuMac *capture = (__bridge MewGpuMac *)host->capture;
        if (![capture stop]) return -1;
        CFRelease(host->capture); host->capture = NULL; return 0;
    }
}
void mew_gpu_destroy(void *p) {
    MacHost *host = p; if (!host) return;
    (void)mew_gpu_stop(p);
    if (host->capture) CFRelease(host->capture);
    if (host->device) CFRelease(host->device);
    free(p);
}
int mew_gpu_start(void *p, int id, int maxWidth, int maxHeight, int fps, int bitrate, int fd, uint32_t node, int profile, int level) {
    (void)fd; (void)node; (void)level;
    if (!p || !mew_gpu_allowed() || !CGDisplayIsActive((uint32_t)id) || maxWidth < 2 || maxWidth > 3840 || maxHeight < 2 || maxHeight > 2160 || fps < 1 || fps > 240 || bitrate < 350000 || bitrate > 50000000 || (profile != 66 && profile != 100)) return -1;
    if (mew_gpu_stop(p)) return -1;
    @autoreleasepool {
        MewGpuMac *capture = [MewGpuMac new];
        capture->queue = dispatch_queue_create("mew.desktop.hardware", DISPATCH_QUEUE_SERIAL);
        capture->stopped = dispatch_group_create();
        capture->bounds = CGDisplayBounds((uint32_t)id);
        capture->screen = (MewGpuScreen){id, (int)capture->bounds.origin.x, (int)capture->bounds.origin.y, (int)capture->bounds.size.width, (int)capture->bounds.size.height, 0};
        capture->physicalWidth = CGDisplayPixelsWide((uint32_t)id); capture->physicalHeight = CGDisplayPixelsHigh((uint32_t)id); capture->rotation = CGDisplayRotation((uint32_t)id);
        double scale = fmin(1, fmin((double)maxWidth / capture->physicalWidth, (double)maxHeight / capture->physicalHeight));
        capture->width = MAX(2, (int)floor(capture->physicalWidth * scale) & ~1); capture->height = MAX(2, (int)floor(capture->physicalHeight * scale) & ~1);
        capture->firstTime = capture->submittedTime = kCMTimeInvalid; capture->forceKey = YES;
        capture->fps = fps;
        NSDictionary *spec = @{(__bridge NSString *)kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: @YES,
                              (__bridge NSString *)kVTVideoEncoderSpecification_EnableLowLatencyRateControl: @YES};
        OSStatus error = VTCompressionSessionCreate(NULL, capture->width, capture->height, kCMVideoCodecType_H264,
            (__bridge CFDictionaryRef)spec, NULL, NULL, output, (__bridge void *)capture, &capture->encoder);
        if (error || !capture->encoder) { [capture stop]; return -1; }
        NSDictionary *properties = @{(__bridge NSString *)kVTCompressionPropertyKey_RealTime: @YES,
            (__bridge NSString *)kVTCompressionPropertyKey_AllowFrameReordering: @NO,
            (__bridge NSString *)kVTCompressionPropertyKey_ProfileLevel: (__bridge NSString *)(profile == 100 ? kVTProfileLevel_H264_ConstrainedHigh_AutoLevel : kVTProfileLevel_H264_Baseline_AutoLevel),
            (__bridge NSString *)kVTCompressionPropertyKey_AverageBitRate: @(bitrate),
            (__bridge NSString *)kVTCompressionPropertyKey_MaxKeyFrameInterval: @(fps * 5),
            (__bridge NSString *)kVTCompressionPropertyKey_ExpectedFrameRate: @(fps)};
        error = VTSessionSetProperties(capture->encoder, (__bridge CFDictionaryRef)properties);
        if (!error) error = VTCompressionSessionPrepareToEncodeFrames(capture->encoder);
        CFTypeRef hardware = NULL;
        if (!error) error = VTSessionCopyProperty(capture->encoder, kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder, NULL, &hardware);
        BOOL accelerated = hardware && CFEqual(hardware, kCFBooleanTrue);
        if (hardware) CFRelease(hardware);
        if (error || !accelerated) { [capture stop]; return -1; }
        capture->activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiated | NSActivityIdleDisplaySleepDisabled reason:@"Mew remote desktop"];
        ((MacHost *)p)->capture = (__bridge_retained void *)capture;
        [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *contentError) {
            dispatch_async(capture->queue, ^{
                if (capture->closed) return;
                SCDisplay *selected = nil;
                for (SCDisplay *display in content.displays) if (display.displayID == (uint32_t)id) { selected = display; break; }
                if (contentError || !selected) { capture->failed = YES; return; }
                SCStreamConfiguration *config = [SCStreamConfiguration new];
                config.width = capture->width; config.height = capture->height;
                config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
                config.showsCursor = YES; config.queueDepth = 3; config.minimumFrameInterval = CMTimeMake(1, fps);
                SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:selected excludingWindows:@[]];
                capture->stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:capture];
                dispatch_group_enter(capture->stopped);
                NSError *outputError = nil;
                if (![capture->stream addStreamOutput:capture type:SCStreamOutputTypeScreen sampleHandlerQueue:capture->queue error:&outputError]) {
                    capture->failed = YES; capture->stream = nil; dispatch_group_leave(capture->stopped); return;
                }
                capture->starting = YES;
                [capture->stream startCaptureWithCompletionHandler:^(NSError *startError) {
                    dispatch_async(capture->queue, ^{ capture->starting = NO; if (startError) capture->failed = YES; if (capture->closed) [capture stopStream]; });
                }];
            });
        }];
        return 0;
    }
}
int mew_gpu_current(void *p, MewGpuScreen *out) {
    MacHost *host = p; if (!host || !host->capture || !out) return -1;
    MewGpuMac *capture = (__bridge MewGpuMac *)host->capture; *out = capture->screen; return 0;
}
int mew_gpu_poll(void *p, uint8_t *out, int capacity, MewGpuFrame *meta) {
    MacHost *host = p; if (!host || !host->capture || !out || !meta) return -1;
    @autoreleasepool {
        MewGpuMac *capture = (__bridge MewGpuMac *)host->capture;
        __block int result = 0;
        dispatch_sync(capture->queue, ^{
            double now = NSProcessInfo.processInfo.systemUptime;
            if (now - capture->health > .5) {
                capture->health = now;
                uint32_t id = (uint32_t)capture->screen.id;
                if (!mew_gpu_allowed() || !CGDisplayIsActive(id) || CGDisplayIsAsleep(id) ||
                    !CGRectEqualToRect(CGDisplayBounds(id), capture->bounds) || CGDisplayPixelsWide(id) != capture->physicalWidth ||
                    CGDisplayPixelsHigh(id) != capture->physicalHeight || CGDisplayRotation(id) != capture->rotation) capture->failed = YES;
            }
            if (capture->closed || capture->failed) { result = -1; return; }
            if (capture->encoded) {
                if (capture->encoded.length > (NSUInteger)capacity) { result = -1; return; }
                memcpy(out, capture->encoded.bytes, capture->encoded.length); *meta = capture->metadata;
                result = meta->length; capture->encoded = nil;
                return; // Consume compressed output before submitting another surface.
            }
            if (capture->busy || !capture->latest || (!capture->fresh && !capture->forceKey)) return;
            CVPixelBufferRef surface = CVPixelBufferRetain(capture->latest);
            if (!CMTIME_IS_NUMERIC(capture->firstTime)) capture->firstTime = capture->latestTime;
            CMTime time = CMTimeSubtract(capture->latestTime, capture->firstTime);
            if (!capture->fresh && CMTIME_IS_NUMERIC(capture->submittedTime)) time = CMTimeAdd(capture->submittedTime, CMTimeMakeWithSeconds(fmax(1.0 / capture->fps, now - capture->submittedAt), 1000000));
            if (CMTIME_IS_NUMERIC(capture->submittedTime) && CMTimeCompare(time, capture->submittedTime) <= 0) time = CMTimeAdd(capture->submittedTime, CMTimeMake(1, capture->fps));
            capture->submittedTime = time; capture->submittedAt = now; capture->fresh = NO;
            NSDictionary *properties = capture->forceKey ? @{(__bridge NSString *)kVTEncodeFrameOptionKey_ForceKeyFrame: @YES} : nil;
            capture->forceKey = NO; capture->busy = YES;
            // No LockBaseAddress, BGRA readback, raw IPC or canvas conversion.
            OSStatus error = VTCompressionSessionEncodeFrame(capture->encoder, surface, time, CMTimeMake(1, capture->fps), (__bridge CFDictionaryRef)properties, NULL, NULL);
            CVPixelBufferRelease(surface);
            if (error) { capture->failed = YES; capture->busy = NO; result = -1; }
        });
        return result;
    }
}
void mew_gpu_keyframe(void *p) {
    MacHost *host = p; if (!host || !host->capture) return;
    MewGpuMac *capture = (__bridge MewGpuMac *)host->capture; dispatch_sync(capture->queue, ^{ capture->forceKey = YES; });
}
void mew_gpu_bitrate(void *p, int bitrate) {
    MacHost *host = p; if (!host || !host->capture || bitrate < 350000 || bitrate > 50000000) return;
    MewGpuMac *capture = (__bridge MewGpuMac *)host->capture;
    dispatch_sync(capture->queue, ^{ if (!capture->closed && capture->encoder && VTSessionSetProperty(capture->encoder, kVTCompressionPropertyKey_AverageBitRate, (__bridge CFNumberRef)@(bitrate))) capture->failed = YES; });
}
MEW_GPU_EXPORT int mew_gpu_permissions(int mode) {
    @autoreleasepool {
        if (mode == 1) {
            NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
            (void)AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
        } else if (mode == 2) (void)CGRequestScreenCaptureAccess();
        return (AXIsProcessTrusted() ? 1 : 0) | (CGPreflightScreenCaptureAccess() ? 2 : 0);
    }
}
MEW_GPU_EXPORT void mew_gpu_pump(void) { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true); }
MEW_GPU_EXPORT int mew_gpu_clipboard(const char *text) {
    @autoreleasepool {
        NSString *value = text ? [NSString stringWithUTF8String:text] : nil;
        if (!value) return -1;
        NSPasteboard *board = NSPasteboard.generalPasteboard; [board clearContents];
        return [board setString:value forType:NSPasteboardTypeString] ? 0 : -1;
    }
}
MEW_GPU_EXPORT int mew_gpu_clipboard_read(void *buffer, int capacity) {
    @autoreleasepool {
        NSString *value = [NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString] ?: @"";
        if (value.length > 4096 || !buffer || capacity < 1) return -1;
        return [value getCString:buffer maxLength:(NSUInteger)capacity encoding:NSUTF8StringEncoding] ? 0 : -1;
    }
}
static _Atomic uint64_t noticeGeneration;
MEW_GPU_EXPORT void mew_gpu_notice(int show) {
    @autoreleasepool {
        UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
        uint64_t previous = atomic_fetch_add(&noticeGeneration, 1), generation = previous + 1;
        if (!show) {
            NSArray *ids = @[[NSString stringWithFormat:@"mew-desktop-%llu", (unsigned long long)previous]];
            [center removePendingNotificationRequestsWithIdentifiers:ids]; [center removeDeliveredNotificationsWithIdentifiers:ids]; return;
        }
        [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert completionHandler:^(BOOL granted, NSError *error) {
            if (!granted || error || atomic_load(&noticeGeneration) != generation) return;
            UNMutableNotificationContent *content = [UNMutableNotificationContent new];
            content.title = @"mew 원격 데스크톱 연결됨"; content.body = @"이 PC에 원격으로 연결되었습니다.";
            NSString *identifier = [NSString stringWithFormat:@"mew-desktop-%llu", (unsigned long long)generation];
            UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
            [center addNotificationRequest:request withCompletionHandler:^(NSError *failure) {
                (void)failure;
                if (atomic_load(&noticeGeneration) != generation) {
                    UNUserNotificationCenter *current = UNUserNotificationCenter.currentNotificationCenter;
                    [current removePendingNotificationRequestsWithIdentifiers:@[identifier]]; [current removeDeliveredNotificationsWithIdentifiers:@[identifier]];
                }
            }];
        }];
    }
}
