#include "gpu-posix.h"
#include <gst/gst.h>
#include <gst/app/gstappsink.h>
#include <gst/video/video-event.h>
#include <X11/Xlib.h>
#include <X11/extensions/Xrandr.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

// GStreamer owns raw CPU/DMABuf/VA/CUDA surfaces. Only H.264 is mapped here.
struct Host {
    Display *display = nullptr;
    GstElement *pipeline = nullptr, *encoder = nullptr, *sink = nullptr, *warm = nullptr;
    GstBus *bus = nullptr;
    std::vector<MewGpuScreen> screens;
    MewGpuScreen selected{};
    MewGpuScreen portalScreen{0, 0, 0, 1920, 1080, 0};
    std::string mode, error;
    int width = 0, height = 0;
    bool portal = false;
    GstClockTime first = GST_CLOCK_TIME_NONE, health = 0;
};
static bool refresh(Host *h) {
    h->screens.clear();
    if (h->portal) { h->screens.push_back(h->portalScreen); return true; }
    int count = 0;
    XRRMonitorInfo *monitors = XRRGetMonitors(h->display, DefaultRootWindow(h->display), True, &count);
    if (monitors) {
        for (int i = 0; i < count && i < 32; ++i) {
            const auto &m = monitors[i];
            if (m.width > 0 && m.height > 0) h->screens.push_back({i, m.x, m.y, m.width, m.height, 0});
        }
        XRRFreeMonitors(monitors);
    }
    if (h->screens.empty()) h->screens.push_back({0, 0, 0, DisplayWidth(h->display, DefaultScreen(h->display)), DisplayHeight(h->display, DefaultScreen(h->display)), 0});
    return !h->screens.empty();
}
[[maybe_unused]] static bool available(const char *name) {
    GstElementFactory *factory = gst_element_factory_find(name);
    if (!factory) return false;
    gst_object_unref(factory); return true;
}
int mew_gpu_abi(void) { return 2; }
MEW_GPU_EXPORT int mew_gpu_source(void *p, int x, int y, int width, int height) {
    auto *h = static_cast<Host *>(p);
    if (!h || !h->portal || h->pipeline || width < 1 || height < 1 || width > 32768 || height > 32768 || std::abs(x) > 32768 || std::abs(y) > 32768) return -1;
    h->portalScreen = {0, x, y, width, height, 0}; return 0;
}
int mew_gpu_allowed(void) { return 1; } // Portal revocation/desktop lock are checked by the parent input owner.
const char *mew_gpu_error(void *p) { return static_cast<Host *>(p)->error.c_str(); }
void *mew_gpu_create(void) {
    if (!gst_init_check(nullptr, nullptr, nullptr)) return nullptr;
    auto *h = new Host;
    h->portal = g_getenv("WAYLAND_DISPLAY") || g_strcmp0(g_getenv("XDG_SESSION_TYPE"), "wayland") == 0;
    if (!h->portal) { h->display = XOpenDisplay(nullptr); if (!h->display) { delete h; return nullptr; } }
#ifdef MEW_GPU_TEST
    h->mode = "test"; // This branch exists only in an independently compiled test library.
#else
    for (const char *name : {"nvh264enc", "vah264enc"}) {
        if (!available(name)) continue;
        GstElement *candidate = gst_element_factory_make(name, nullptr);
        if (candidate && gst_element_set_state(candidate, GST_STATE_READY) != GST_STATE_CHANGE_FAILURE) {
            h->warm = candidate; h->mode = name; break;
        }
        if (candidate) { gst_element_set_state(candidate, GST_STATE_NULL); gst_object_unref(candidate); }
    }
    if (h->mode.empty()) { if (h->display) XCloseDisplay(h->display); delete h; return nullptr; }
#endif
    refresh(h); return h;
}
int mew_gpu_screens(void *p, MewGpuScreen *out, int capacity) {
    auto *h = static_cast<Host *>(p);
    if (!h || h->pipeline || !out || capacity < 1 || !refresh(h)) return -1;
    const int count = std::min(capacity, static_cast<int>(h->screens.size()));
    std::copy_n(h->screens.begin(), count, out); return count;
}
int mew_gpu_stop(void *p) {
    auto *h = static_cast<Host *>(p);
    if (!h) return -1;
    if (h->pipeline && gst_element_set_state(h->pipeline, GST_STATE_NULL) == GST_STATE_CHANGE_FAILURE) return -1;
    if (h->sink) gst_object_unref(h->sink);
    if (h->encoder) gst_object_unref(h->encoder);
    if (h->bus) gst_object_unref(h->bus);
    if (h->pipeline) gst_object_unref(h->pipeline);
    h->pipeline = h->encoder = h->sink = nullptr; h->bus = nullptr; h->first = GST_CLOCK_TIME_NONE;
    return 0;
}
void mew_gpu_destroy(void *p) {
    auto *h = static_cast<Host *>(p); if (!h) return;
    mew_gpu_stop(h);
    if (h->warm) { gst_element_set_state(h->warm, GST_STATE_NULL); gst_object_unref(h->warm); }
    if (h->display) XCloseDisplay(h->display);
    delete h;
}
int mew_gpu_start(void *p, int id, int maxWidth, int maxHeight, int fps, int bitrate, int fd, uint32_t node, int profile, int level) {
    auto *h = static_cast<Host *>(p);
    mew_gpu_stop(h); h->error.clear();
    if (maxWidth < 2 || maxHeight < 2 || maxWidth > 3840 || maxHeight > 2160 || fps < 1 || fps > 240 || bitrate < 350000 || bitrate > 50000000 || (profile != 66 && profile != 100) || level < 31 || level > 62 || !refresh(h)) return -1;
    auto selected = std::find_if(h->screens.begin(), h->screens.end(), [id](const auto &s) { return s.id == id; });
    if (selected == h->screens.end() || (h->portal && (fd < 0 || !node))) { h->error = "화면 공유 승인과 PipeWire 연결을 확인해 주세요."; return -1; }
    h->selected = *selected;
    double ratio = std::min({1.0, double(maxWidth) / selected->width, double(maxHeight) / selected->height});
    h->width = std::max(2, int(std::floor(selected->width * ratio)) & ~1);
    h->height = std::max(2, int(std::floor(selected->height * ratio)) & ~1);
    std::string source;
    if (h->portal) source = "pipewiresrc do-timestamp=true fd=" + std::to_string(fd) + " path=" + std::to_string(node);
    else source = "ximagesrc use-damage=false show-pointer=true startx=" + std::to_string(selected->x) + " starty=" + std::to_string(selected->y) + " endx=" + std::to_string(selected->x + selected->width - 1) + " endy=" + std::to_string(selected->y + selected->height - 1) + " ! video/x-raw,framerate=" + std::to_string(fps) + "/1";
    const std::string dimensions = ",width=" + std::to_string(h->width) + ",height=" + std::to_string(h->height);
    std::string encode;
    if (h->mode == "nvh264enc") encode = (h->portal ? "glupload ! glcolorconvert ! video/x-raw(memory:GLMemory),format=RGBA ! " : "") + std::string("cudaupload ! cudaconvert ! cudascale ! video/x-raw(memory:CUDAMemory),format=NV12") + dimensions + " ! nvh264enc name=encoder bframes=0 rc-lookahead=0 zerolatency=true rc-mode=cbr gop-size=" + std::to_string(fps * 5) + " bitrate=";
    else if (h->mode == "vah264enc") encode = "vapostproc ! video/x-raw(memory:VAMemory),format=NV12" + dimensions + " ! vah264enc name=encoder b-frames=0 ref-frames=1 cabac=" + (profile == 100 ? std::string("true dct8x8=true") : std::string("false dct8x8=false")) + " key-int-max=" + std::to_string(fps * 5) + " bitrate=";
#ifdef MEW_GPU_TEST
    else encode = "videoconvert ! videoscale ! video/x-raw,format=I420" + dimensions + " ! x264enc name=encoder tune=zerolatency speed-preset=ultrafast bframes=0 rc-lookahead=0 key-int-max=" + std::to_string(fps * 5) + " bitrate=";
#endif
    if (encode.empty()) { h->error = "하드웨어 H.264 인코더가 없습니다."; return -1; }
    // Drop only unencoded surfaces. Blocking compressed output preserves H.264 references.
    const std::string limit = std::to_string(level / 10) + (level % 10 ? "." + std::to_string(level % 10) : "");
    const std::string pipeline = source + " ! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream ! " + encode + std::to_string(bitrate / 1000) + " ! h264parse config-interval=-1 ! video/x-h264,stream-format=byte-stream,alignment=au,profile=" + (profile == 100 ? "high" : "constrained-baseline") + ",level=(string)" + limit + " ! appsink name=output max-buffers=1 drop=false sync=false async=false wait-on-eos=false";
    GError *error = nullptr;
    h->pipeline = gst_parse_launch(pipeline.c_str(), &error);
    if (error || !h->pipeline) {
        // Do not copy diagnostic strings containing DISPLAY/portal details to logs.
        if (error) g_error_free(error);
        h->error = "Linux 영상 라이브러리가 부족합니다. GStreamer의 X11/PipeWire·VA-API/NVENC·H.264 parser 플러그인을 확인해 주세요.";
        mew_gpu_stop(h); return -1;
    }
    h->sink = gst_bin_get_by_name(GST_BIN(h->pipeline), "output");
    h->encoder = gst_bin_get_by_name(GST_BIN(h->pipeline), "encoder"); h->bus = gst_element_get_bus(h->pipeline);
    if (h->encoder && h->mode == "nvh264enc") {
        GObjectClass *properties = G_OBJECT_GET_CLASS(h->encoder);
        if (g_object_class_find_property(properties, "vbv-buffer-size")) g_object_set(h->encoder, "vbv-buffer-size", static_cast<guint>(std::max(16, bitrate / fps / 1000 * 2)), nullptr);
        GParamSpec *tune = g_object_class_find_property(properties, "tune");
        if (tune && G_IS_PARAM_SPEC_ENUM(tune)) {
            auto *values = static_cast<GEnumClass *>(g_type_class_ref(tune->value_type));
            GEnumValue *low = g_enum_get_value_by_nick(values, "ultra-low-latency");
            if (low) g_object_set(h->encoder, "tune", low->value, nullptr);
            g_type_class_unref(values);
        }
    }
    if (!h->sink || !h->encoder || gst_element_set_state(h->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
        h->error = "Linux GPU 영상 시작에 실패했습니다. 그래픽 드라이버·화면 권한을 확인해 주세요."; mew_gpu_stop(h); return -1;
    }
    h->health = gst_util_get_timestamp(); return 0;
}
int mew_gpu_current(void *p, MewGpuScreen *out) {
    auto *h = static_cast<Host *>(p); if (!h || !h->pipeline || !out) return -1;
    *out = h->selected; return 0;
}
int mew_gpu_poll(void *p, uint8_t *out, int capacity, MewGpuFrame *meta) {
    auto *h = static_cast<Host *>(p); if (!h || !h->pipeline || !out || !meta) return -1;
    GstMessage *message = gst_bus_pop_filtered(h->bus, static_cast<GstMessageType>(GST_MESSAGE_ERROR | GST_MESSAGE_EOS));
    if (message) { gst_message_unref(message); h->error = "Linux 화면 공유·GPU 인코딩이 종료됐습니다. 다시 연결해 주세요."; return -1; }
    if (!h->portal && gst_util_get_timestamp() - h->health > GST_SECOND / 2) {
        h->health = gst_util_get_timestamp(); refresh(h);
        auto s = std::find_if(h->screens.begin(), h->screens.end(), [h](const auto &item) { return item.id == h->selected.id; });
        if (s == h->screens.end() || std::memcmp(&*s, &h->selected, sizeof(MewGpuScreen))) { h->error = "화면 구성이 바뀌었습니다. 다시 연결해 주세요."; return -1; }
    }
    GstSample *sample = gst_app_sink_try_pull_sample(GST_APP_SINK(h->sink), 0);
    if (!sample) return 0;
    GstBuffer *buffer = gst_sample_get_buffer(sample); GstMapInfo map{};
    if (!buffer || !gst_buffer_map(buffer, &map, GST_MAP_READ)) { gst_sample_unref(sample); return -1; }
    int result = -1;
    const auto pts = GST_BUFFER_PTS(buffer);
    if (map.size > 0 && map.size <= static_cast<size_t>(capacity) && GST_CLOCK_TIME_IS_VALID(pts)) {
        if (!GST_CLOCK_TIME_IS_VALID(h->first)) h->first = pts;
        std::memcpy(out, map.data, map.size);
        *meta = {static_cast<int>(map.size), h->width, h->height, !GST_BUFFER_FLAG_IS_SET(buffer, GST_BUFFER_FLAG_DELTA_UNIT), static_cast<int64_t>((pts >= h->first ? pts - h->first : 0) / GST_USECOND)};
        result = meta->length;
    } else h->error = "GPU 영상 프레임이 제한을 초과했습니다.";
    gst_buffer_unmap(buffer, &map); gst_sample_unref(sample); return result;
}
void mew_gpu_keyframe(void *p) {
    auto *h = static_cast<Host *>(p); if (!h || !h->encoder) return;
    GstPad *pad = gst_element_get_static_pad(h->encoder, "src");
    if (pad) { gst_pad_send_event(pad, gst_video_event_new_upstream_force_key_unit(GST_CLOCK_TIME_NONE, TRUE, 0)); gst_object_unref(pad); }
}
void mew_gpu_bitrate(void *p, int bitrate) {
    auto *h = static_cast<Host *>(p);
    if (h && h->encoder) g_object_set(h->encoder, "bitrate", static_cast<guint>(std::clamp(bitrate, 350000, 50000000) / 1000), nullptr);
}
