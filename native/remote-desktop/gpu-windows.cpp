// Windows GPU surface -> NV12 -> hardware H.264. No raw pixels cross the ABI.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3d10.h>
#include <dxgi1_4.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <codecapi.h>
#include <strmif.h>
#include <wrl/client.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include "virtual-display-client.h"
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <vector>

using Microsoft::WRL::ComPtr;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
struct Screen { int32_t id, x, y, width, height, primary; };
struct Frame { int32_t bytes, width, height, key; int64_t timestamp; };
struct Monitor { ComPtr<IDXGIAdapter1> adapter; ComPtr<IDXGIOutput1> output; DXGI_OUTPUT_DESC desc; };
struct Engine {
    std::vector<Monitor> monitors;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    GraphicsCaptureItem item{nullptr};
    Direct3D11CaptureFramePool pool{nullptr};
    GraphicsCaptureSession capture{nullptr};
    HANDLE virtualDisplay=INVALID_HANDLE_VALUE;
    DPI_AWARENESS_CONTEXT previousDpi=nullptr;
    Screen current{};
    DWORD64 renewed=0, firstDeadline=0;
    int sourceWidth=0, sourceHeight=0;
    ComPtr<ID3D11VideoDevice> videoDevice;
    ComPtr<ID3D11VideoContext> videoContext;
    ComPtr<ID3D11VideoProcessorEnumerator> enumerator;
    ComPtr<ID3D11VideoProcessor> processor;
    ComPtr<ID3D11Texture2D> latest;
    ComPtr<IMFDXGIDeviceManager> manager;
    ComPtr<IMFTransform> encoder;
    ComPtr<IMFMediaEventGenerator> events;
    ComPtr<ICodecAPI> codec;
    HRESULT error = S_OK;
    LUID deviceLuid{};
    int selected = -1, width = 0, height = 0, fps = 60, inFlight = 0, inputCredits = 0;
    bool active = false, refresh = true;
    LARGE_INTEGER frequency{}, origin{}, nextInput{};
    ~Engine() { stop(); context.Reset(); device.Reset();if(previousDpi)SetThreadDpiAwarenessContext(previousDpi);MFShutdown(); CoUninitialize(); }
    void stop() {
        active = false;
        if(capture){try{capture.Close();}catch(...){}capture=nullptr;}
        if(pool){try{pool.Close();}catch(...){}pool=nullptr;}item=nullptr;
        if (encoder) {
            encoder->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
        }
        codec.Reset(); events.Reset(); encoder.Reset(); manager.Reset();
        latest.Reset(); processor.Reset(); enumerator.Reset(); videoContext.Reset(); videoDevice.Reset();
        inputCredits = 0; inFlight = 0; refresh = true;
        if(virtualDisplay!=INVALID_HANDLE_VALUE){DWORD bytes=0;DeviceIoControl(virtualDisplay,mewDisplayRelease,nullptr,0,nullptr,0,&bytes,nullptr);CloseHandle(virtualDisplay);virtualDisplay=INVALID_HANDLE_VALUE;}
    }
    HRESULT gpuAdapter(IDXGIAdapter1* adapter) {
        DXGI_ADAPTER_DESC1 target{}; HRESULT hr=adapter->GetDesc1(&target); if(FAILED(hr))return hr;
        if(target.Flags&DXGI_ADAPTER_FLAG_SOFTWARE)return DXGI_ERROR_UNSUPPORTED;
        if (device && deviceLuid.LowPart==target.AdapterLuid.LowPart && deviceLuid.HighPart==target.AdapterLuid.HighPart) return S_OK;
        deviceLuid=target.AdapterLuid;
        context.Reset(); device.Reset();
        const D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
        D3D_FEATURE_LEVEL level;
        hr=D3D11CreateDevice(adapter, D3D_DRIVER_TYPE_UNKNOWN, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            levels, 2, D3D11_SDK_VERSION, &device, &level, &context);
        if(SUCCEEDED(hr)){ComPtr<ID3D10Multithread> protection;if(SUCCEEDED(device.As(&protection)))protection->SetMultithreadProtected(TRUE);}
        return hr;
    }
    HRESULT gpu(int index) { selected=index;return gpuAdapter(monitors[index].adapter.Get()); }
    HRESULT value(const GUID& property, ULONG number) {
        if (!codec) return E_NOINTERFACE;
        VARIANT v; VariantInit(&v); v.vt = VT_UI4; v.ulVal = number;
        return codec->SetValue(&property, &v);
    }
    void boolean(const GUID& property, bool enabled) {
        if (!codec) return;
        VARIANT v; VariantInit(&v); v.vt = VT_BOOL; v.boolVal = enabled ? VARIANT_TRUE : VARIANT_FALSE;
        codec->SetValue(&property, &v);
    }
};

static bool unlocked() {
    HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!desktop) return false;
    wchar_t name[128]{}; DWORD size = 0;
    bool ok = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &size) && _wcsicmp(name, L"Default") == 0;
    CloseDesktop(desktop); return ok;
}
static HRESULT type(IMFMediaType** result, GUID subtype, int width, int height, int fps, int bitrate) {
    ComPtr<IMFMediaType> media; HRESULT hr = MFCreateMediaType(&media);
    if (FAILED(hr)) return hr;
    media->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); media->SetGUID(MF_MT_SUBTYPE, subtype);
    MFSetAttributeSize(media.Get(), MF_MT_FRAME_SIZE, width, height);
    MFSetAttributeRatio(media.Get(), MF_MT_FRAME_RATE, fps, 1);
    MFSetAttributeRatio(media.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    media->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    if (subtype == MFVideoFormat_H264) {
        media->SetUINT32(MF_MT_AVG_BITRATE, bitrate);
        media->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base);
    }
    *result = media.Detach(); return S_OK;
}
static HRESULT encoder(Engine* e, int bitrate) {
    ComPtr<IMFAttributes> filter; HRESULT hr = MFCreateAttributes(&filter, 1);
    if (FAILED(hr)) return hr;
    uint64_t luid; static_assert(sizeof(luid) == sizeof(e->deviceLuid)); memcpy(&luid, &e->deviceLuid, sizeof(luid));
    filter->SetUINT64(MFT_ENUM_ADAPTER_LUID, luid);
    MFT_REGISTER_TYPE_INFO input{ MFMediaType_Video, MFVideoFormat_NV12 }, output{ MFMediaType_Video, MFVideoFormat_H264 };
    IMFActivate** activations = nullptr; UINT32 count = 0;
    hr = MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
        &input, &output, filter.Get(), &activations, &count);
    if (FAILED(hr)) return hr;
    HRESULT last = MF_E_TOPO_CODEC_NOT_FOUND;
    UINT reset = 0;
    hr = MFCreateDXGIDeviceManager(&reset, &e->manager);
    if (SUCCEEDED(hr)) hr = e->manager->ResetDevice(e->device.Get(), reset);
    if (FAILED(hr)) { for (UINT i=0;i<count;i++) activations[i]->Release(); CoTaskMemFree(activations); return hr; }
    for (UINT i=0;i<count;i++) {
        ComPtr<IMFTransform> candidate;
        hr = activations[i]->ActivateObject(IID_PPV_ARGS(&candidate));
        if (SUCCEEDED(hr)) {
            ComPtr<IMFAttributes> attrs; hr = candidate->GetAttributes(&attrs);
            if (SUCCEEDED(hr)) { attrs->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE); attrs->SetUINT32(MF_LOW_LATENCY, TRUE); }
            if (SUCCEEDED(hr)) hr = candidate->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, reinterpret_cast<ULONG_PTR>(e->manager.Get()));
            ComPtr<IMFMediaType> out, in;
            if (SUCCEEDED(hr)) hr = type(&out, MFVideoFormat_H264, e->width, e->height, e->fps, bitrate);
            if (SUCCEEDED(hr)) hr = candidate->SetOutputType(0, out.Get(), 0);
            if (SUCCEEDED(hr)) hr = type(&in, MFVideoFormat_NV12, e->width, e->height, e->fps, bitrate);
            if (SUCCEEDED(hr)) hr = candidate->SetInputType(0, in.Get(), 0);
            if (SUCCEEDED(hr)) hr = candidate.As(&e->events);
            if (SUCCEEDED(hr)) {
                e->encoder = candidate; candidate.As(&e->codec);
                e->boolean(CODECAPI_AVLowLatencyMode, true);
                e->value(CODECAPI_AVEncCommonRateControlMode, eAVEncCommonRateControlMode_CBR);
                e->value(CODECAPI_AVEncCommonMeanBitRate, bitrate);
                e->value(CODECAPI_AVEncMPVDefaultBPictureCount, 0);
                e->value(CODECAPI_AVEncMPVGOPSize, e->fps * 10);
                hr = candidate->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
                if (SUCCEEDED(hr)) hr = candidate->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
                if (SUCCEEDED(hr)) { last = S_OK; break; }
                e->events.Reset(); e->codec.Reset(); e->encoder.Reset();
            }
        }
        last = hr;
    }
    for (UINT i=0;i<count;i++) activations[i]->Release(); CoTaskMemFree(activations);
    return last;
}
static HRESULT convert(Engine* e, ID3D11Texture2D* source, IMFSample** result, int64_t timestamp) {
    D3D11_TEXTURE2D_DESC desc{}; desc.Width=e->width; desc.Height=e->height; desc.MipLevels=1; desc.ArraySize=1;
    desc.Format=DXGI_FORMAT_NV12; desc.SampleDesc.Count=1; desc.Usage=D3D11_USAGE_DEFAULT; desc.BindFlags=D3D11_BIND_RENDER_TARGET;
    ComPtr<ID3D11Texture2D> texture; HRESULT hr = e->device->CreateTexture2D(&desc, nullptr, &texture);
    if (FAILED(hr)) return hr;
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC iv{}; iv.ViewDimension=D3D11_VPIV_DIMENSION_TEXTURE2D;
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ov{}; ov.ViewDimension=D3D11_VPOV_DIMENSION_TEXTURE2D;
    ComPtr<ID3D11VideoProcessorInputView> input; ComPtr<ID3D11VideoProcessorOutputView> output;
    hr = e->videoDevice->CreateVideoProcessorInputView(source, e->enumerator.Get(), &iv, &input);
    if (SUCCEEDED(hr)) hr = e->videoDevice->CreateVideoProcessorOutputView(texture.Get(), e->enumerator.Get(), &ov, &output);
    if (FAILED(hr)) return hr;
    D3D11_VIDEO_PROCESSOR_STREAM stream{}; stream.Enable=TRUE; stream.pInputSurface=input.Get();
    hr = e->videoContext->VideoProcessorBlt(e->processor.Get(), output.Get(), 0, 1, &stream);
    if (FAILED(hr)) return hr;
    ComPtr<IMFMediaBuffer> buffer; ComPtr<IMFSample> sample;
    hr = MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), texture.Get(), 0, FALSE, &buffer);
    if (SUCCEEDED(hr)) hr = MFCreateSample(&sample);
    if (SUCCEEDED(hr)) hr = sample->AddBuffer(buffer.Get());
    if (SUCCEEDED(hr)) hr = sample->SetSampleTime(timestamp);
    if (SUCCEEDED(hr)) hr = sample->SetSampleDuration(10000000 / e->fps);
    if (FAILED(hr)) return hr;
    *result=sample.Detach(); return S_OK;
}
static HRESULT output(Engine* e, unsigned char* data, int capacity, Frame* frame) {
    MFT_OUTPUT_STREAM_INFO info{}; HRESULT hr=e->encoder->GetOutputStreamInfo(0, &info);
    if (FAILED(hr)) return hr;
    ComPtr<IMFSample> supplied;
    if (!(info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)) {
        ComPtr<IMFMediaBuffer> buffer; hr=MFCreateSample(&supplied);
        if (SUCCEEDED(hr)) hr=MFCreateMemoryBuffer(std::max<ULONG>(info.cbSize, 1024*1024), &buffer);
        if (SUCCEEDED(hr)) hr=supplied->AddBuffer(buffer.Get());
        if (FAILED(hr)) return hr;
    }
    MFT_OUTPUT_DATA_BUFFER out{}; out.pSample=supplied.Get(); DWORD status=0;
    hr=e->encoder->ProcessOutput(0, 1, &out, &status);
    if (out.pEvents) out.pEvents->Release();
    ComPtr<IMFSample> sample;
    if (out.pSample == supplied.Get()) sample=supplied; else sample.Attach(out.pSample);
    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return S_FALSE;
    if (FAILED(hr) || !sample) return FAILED(hr) ? hr : E_UNEXPECTED;
    ComPtr<IMFMediaBuffer> buffer; hr=sample->ConvertToContiguousBuffer(&buffer);
    if (FAILED(hr)) return hr;
    BYTE* bytes=nullptr; DWORD length=0;
    hr=buffer->Lock(&bytes, nullptr, &length);
    if (FAILED(hr)) return hr;
    if (length > static_cast<DWORD>(capacity)) { buffer->Unlock(); return E_OUTOFMEMORY; }
    memcpy(data, bytes, length); buffer->Unlock();
    LONGLONG time=0; UINT32 key=0; sample->GetSampleTime(&time); sample->GetUINT32(MFSampleExtension_CleanPoint, &key);
    frame->bytes=length; frame->width=e->width; frame->height=e->height; frame->timestamp=time/10; frame->key=key;
    e->inFlight=std::max(0, e->inFlight-1); return S_OK;
}

static bool hardwareH264(LUID id) {
    ComPtr<IMFAttributes> filter;if(FAILED(MFCreateAttributes(&filter,1)))return false;
    uint64_t value;memcpy(&value,&id,8);filter->SetUINT64(MFT_ENUM_ADAPTER_LUID,value);
    MFT_REGISTER_TYPE_INFO in{MFMediaType_Video,MFVideoFormat_NV12},out{MFMediaType_Video,MFVideoFormat_H264};
    IMFActivate** candidates=nullptr;UINT32 count=0;
    HRESULT hr=MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER,MFT_ENUM_FLAG_HARDWARE|MFT_ENUM_FLAG_SORTANDFILTER,&in,&out,filter.Get(),&candidates,&count);
    for(UINT32 i=0;i<count;i++)candidates[i]->Release();CoTaskMemFree(candidates);return SUCCEEDED(hr) && count>0;
}
static HRESULT refreshScreens(Engine* e) {
    if (e->active) return MF_E_INVALIDREQUEST;
    e->monitors.clear();
    ComPtr<IDXGIFactory1> factory;
    HRESULT hr=CreateDXGIFactory1(IID_PPV_ARGS(&factory));if(FAILED(hr))return hr;
    ComPtr<IDXGIAdapter1> warm;
    HMONITOR owned=findMewMonitor();
    for (UINT a=0; SUCCEEDED(hr); a++) {
        ComPtr<IDXGIAdapter1> adapter;
        hr=factory->EnumAdapters1(a, &adapter); if (FAILED(hr)) break;
        DXGI_ADAPTER_DESC1 info{};adapter->GetDesc1(&info);
        if(!warm && !(info.Flags&DXGI_ADAPTER_FLAG_SOFTWARE) && hardwareH264(info.AdapterLuid))warm=adapter;
        for (UINT o=0;;o++) {
            ComPtr<IDXGIOutput> output;
            if (FAILED(adapter->EnumOutputs(o, &output))) break;
            Monitor m; m.adapter=adapter;
            if (output && SUCCEEDED(output->GetDesc(&m.desc)) && m.desc.AttachedToDesktop && SUCCEEDED(output.As(&m.output)) && m.desc.Monitor!=owned) e->monitors.push_back(m);
        }
    }
    std::stable_sort(e->monitors.begin(), e->monitors.end(), [](const Monitor& a, const Monitor& b) {
        auto primary=[](const Monitor& m){return m.desc.DesktopCoordinates.left==0 && m.desc.DesktopCoordinates.top==0;};
        return primary(a) > primary(b);
    });
    if(!e->monitors.empty())return e->gpu(0);
    // A render device can stay ready even with no physical output attached.
    return warm ? e->gpuAdapter(warm.Get()) : DXGI_ERROR_NOT_FOUND;
}

static HRESULT virtualScreen(Engine* e,HMONITOR* monitor) {
    e->virtualDisplay=openMewDisplay();if(e->virtualDisplay==INVALID_HANDLE_VALUE)return HRESULT_FROM_WIN32(GetLastError());
    MewDisplayRequest request{mewDisplayVersion,e->deviceLuid};DWORD bytes=0;
    if(!DeviceIoControl(e->virtualDisplay,mewDisplayAcquire,&request,sizeof(request),nullptr,0,&bytes,nullptr))return HRESULT_FROM_WIN32(GetLastError());
    DWORD64 deadline=GetTickCount64()+4000;
    while(GetTickCount64()<deadline) {
        if(!unlocked())return E_ACCESSDENIED;
        if(!DeviceIoControl(e->virtualDisplay,mewDisplayRenew,nullptr,0,nullptr,0,&bytes,nullptr))return HRESULT_FROM_WIN32(GetLastError());
        LONG layout=activateMewDisplay();
        if(layout!=ERROR_SUCCESS && layout!=ERROR_NOT_FOUND && layout!=ERROR_GEN_FAILURE)return HRESULT_FROM_WIN32(layout);
        auto found=findMewMonitor();
        MewDisplayStatus state{};
        if(found && DeviceIoControl(e->virtualDisplay,mewDisplayStatus,nullptr,0,&state,sizeof(state),&bytes,nullptr) && state.version==mewDisplayVersion && state.active && (state.render.LowPart || state.render.HighPart)) {
            // The OS may choose a different render GPU. Match that GPU before
            // WGC and MF initialize, rather than copying pixels across GPUs.
            ComPtr<IDXGIFactory4> factory;ComPtr<IDXGIAdapter1> adapter;
            HRESULT hr=CreateDXGIFactory1(IID_PPV_ARGS(&factory));
            if(SUCCEEDED(hr))hr=factory->EnumAdapterByLuid(state.render,IID_PPV_ARGS(&adapter));
            if(SUCCEEDED(hr))hr=e->gpuAdapter(adapter.Get());if(FAILED(hr))return hr;
            *monitor=found;e->renewed=GetTickCount64();return S_OK;
        }
        Sleep(15);
    }
    return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
}

extern "C" {
__declspec(dllexport) int mew_gpu_abi() { return 3; }
__declspec(dllexport) void* mew_gpu_create() {
    DWORD session=0;
    if (!ProcessIdToSessionId(GetCurrentProcessId(), &session) || !session || !unlocked()) return nullptr;
    HRESULT hr=CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) return nullptr;
    if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_LITE))) { CoUninitialize(); return nullptr; }
    auto e=new Engine;
    e->previousDpi=SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    QueryPerformanceFrequency(&e->frequency); QueryPerformanceCounter(&e->origin);
    hr=refreshScreens(e);
    if (FAILED(hr)) { delete e; return nullptr; }
    return e;
}
__declspec(dllexport) int mew_gpu_refresh(void* handle) {
    auto e=static_cast<Engine*>(handle); if(!e)return -1;
    e->error=refreshScreens(e); return FAILED(e->error) ? -1 : 0;
}
__declspec(dllexport) int mew_gpu_screens(void* handle, Screen* screens, int capacity) {
    auto e=static_cast<Engine*>(handle); if (!e || !screens || capacity<1) return -1;
    int count=std::min<int>(capacity, e->monitors.size());
    for(int i=0;i<count;i++) { const RECT& r=e->monitors[i].desc.DesktopCoordinates; screens[i]={i,r.left,r.top,r.right-r.left,r.bottom-r.top,r.left==0 && r.top==0}; }
    HANDLE driver=openMewDisplay();if(driver!=INVALID_HANDLE_VALUE){CloseHandle(driver);if(count<capacity)screens[count++]={99,0,0,1920,1080,0};}
    return count;
}
__declspec(dllexport) int mew_gpu_current(void* handle,Screen* screen) { auto e=static_cast<Engine*>(handle);if(!e || !e->active || !screen)return -1;*screen=e->current;return 0; }
__declspec(dllexport) int mew_gpu_start(void* handle, int index, int maxWidth, int maxHeight, int fps, int bitrate) {
    auto e=static_cast<Engine*>(handle);
    if (!e || index<0 || (index!=99 && index>=static_cast<int>(e->monitors.size())) || maxWidth<2 || maxWidth>4096 || maxHeight<2 || maxHeight>2160 || fps<1 || fps>120 || bitrate<350000 || bitrate>20000000) return -1;
    e->stop(); e->error=S_OK;
    auto run=[&]() -> HRESULT {
        if (!unlocked()) return E_ACCESSDENIED;
        HMONITOR monitor=nullptr;HRESULT hr=S_OK;
        if(index==99)hr=virtualScreen(e,&monitor);
        else {hr=e->gpu(index);monitor=e->monitors[index].desc.Monitor;}
        if(FAILED(hr))return hr;
        MONITORINFO info{};info.cbSize=sizeof(info);if(!GetMonitorInfoW(monitor,&info))return HRESULT_FROM_WIN32(GetLastError());
        RECT r=info.rcMonitor;e->current={index,r.left,r.top,r.right-r.left,r.bottom-r.top,static_cast<int>((info.dwFlags&MONITORINFOF_PRIMARY)!=0)};
        auto interop=winrt::get_activation_factory<GraphicsCaptureItem,IGraphicsCaptureItemInterop>();
        winrt::check_hresult(interop->CreateForMonitor(monitor,winrt::guid_of<GraphicsCaptureItem>(),winrt::put_abi(e->item)));
        auto size=e->item.Size();e->sourceWidth=size.Width;e->sourceHeight=size.Height;
        if(size.Width<2 || size.Height<2)return DXGI_ERROR_NOT_FOUND;
        double ratio=std::min({1.0,static_cast<double>(maxWidth)/size.Width,static_cast<double>(maxHeight)/size.Height});
        e->width=std::max(2,static_cast<int>(size.Width*ratio)/2*2); e->height=std::max(2,static_cast<int>(size.Height*ratio)/2*2); e->fps=fps;
        ComPtr<IDXGIDevice> dxgi;hr=e->device.As(&dxgi);if(FAILED(hr))return hr;
        winrt::com_ptr<IInspectable> inspectable;winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(),inspectable.put()));
        auto captureDevice=inspectable.as<IDirect3DDevice>();
        e->pool=Direct3D11CaptureFramePool::CreateFreeThreaded(captureDevice,DirectXPixelFormat::B8G8R8A8UIntNormalized,2,size);
        e->capture=e->pool.CreateCaptureSession(e->item);e->capture.IsCursorCaptureEnabled(false);
        hr=e->device.As(&e->videoDevice); if (SUCCEEDED(hr)) hr=e->context.As(&e->videoContext); if (FAILED(hr)) return hr;
        D3D11_VIDEO_PROCESSOR_CONTENT_DESC content{}; content.InputFrameFormat=D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
        content.InputFrameRate={static_cast<UINT>(fps),1}; content.OutputFrameRate=content.InputFrameRate;
        content.InputWidth=size.Width; content.InputHeight=size.Height; content.OutputWidth=e->width; content.OutputHeight=e->height;
        content.Usage=D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
        hr=e->videoDevice->CreateVideoProcessorEnumerator(&content, &e->enumerator);
        if (SUCCEEDED(hr)) hr=e->videoDevice->CreateVideoProcessor(e->enumerator.Get(),0,&e->processor);
        if (FAILED(hr)) return hr;
        e->videoContext->VideoProcessorSetStreamFrameFormat(e->processor.Get(),0,D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
        D3D11_VIDEO_PROCESSOR_COLOR_SPACE rgb{}; rgb.RGB_Range=0;
        D3D11_VIDEO_PROCESSOR_COLOR_SPACE yuv{}; yuv.YCbCr_Matrix=1; yuv.Nominal_Range=1;
        e->videoContext->VideoProcessorSetStreamColorSpace(e->processor.Get(),0,&rgb);
        e->videoContext->VideoProcessorSetOutputColorSpace(e->processor.Get(),&yuv);
        hr=encoder(e,bitrate); if (FAILED(hr)) return hr;
        e->capture.StartCapture();e->active=true; e->nextInput.QuadPart=0;e->firstDeadline=GetTickCount64()+4000; return S_OK;
    };
    try{e->error=run();}catch(const winrt::hresult_error& error){e->error=error.code();}catch(...){e->error=E_FAIL;}
    if (FAILED(e->error)) { e->stop(); return -1; } return 0;
}
__declspec(dllexport) int mew_gpu_poll(void* handle, unsigned char* data, int capacity, Frame* frame) {
    auto e=static_cast<Engine*>(handle); if (!e || !e->active || !data || capacity<1 || !frame) return -1;
    *frame={};
    auto run=[&]() -> HRESULT {
        if (!unlocked()) return E_ACCESSDENIED;
        if(e->virtualDisplay!=INVALID_HANDLE_VALUE && GetTickCount64()-e->renewed>=1000) {
            DWORD bytes=0;MewDisplayStatus status{};
            if(!DeviceIoControl(e->virtualDisplay,mewDisplayRenew,nullptr,0,nullptr,0,&bytes,nullptr))return HRESULT_FROM_WIN32(GetLastError());
            if(!DeviceIoControl(e->virtualDisplay,mewDisplayStatus,nullptr,0,&status,sizeof(status),&bytes,nullptr) || !status.active || status.version!=mewDisplayVersion)return E_ACCESSDENIED;
            if(status.render.LowPart!=e->deviceLuid.LowPart || status.render.HighPart!=e->deviceLuid.HighPart)return DXGI_ERROR_ACCESS_LOST;
            e->renewed=GetTickCount64();
        }
        if(!e->latest && GetTickCount64()>e->firstDeadline)return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
        for(int n=0;n<16;n++) {
            ComPtr<IMFMediaEvent> event; HRESULT hr=e->events->GetEvent(MF_EVENT_FLAG_NO_WAIT,&event);
            if (hr==MF_E_NO_EVENTS_AVAILABLE) break; if (FAILED(hr)) return hr;
            MediaEventType kind; event->GetType(&kind); HRESULT status=S_OK; event->GetStatus(&status); if(FAILED(status))return status;
            // Each async event authorizes one sample; coalescing events loses
            // credits on encoders that advertise several inputs at once.
            if(kind==METransformNeedInput)e->inputCredits=std::min(16,e->inputCredits+1);
            if(kind==METransformHaveOutput) { hr=output(e,data,capacity,frame); if(hr==S_OK || FAILED(hr))return hr; }
        }
        if (!e->inputCredits || e->inFlight>=3) return S_FALSE;
        LARGE_INTEGER now; QueryPerformanceCounter(&now);
        if (now.QuadPart < e->nextInput.QuadPart) return S_FALSE;
        Direct3D11CaptureFrame newest{nullptr};
        for(int i=0;i<2;i++){auto next=e->pool.TryGetNextFrame();if(!next)break;if(newest)newest.Close();newest=std::move(next);}
        HRESULT hr=S_OK;
        if(newest) {
            auto size=newest.ContentSize();if(size.Width!=e->sourceWidth || size.Height!=e->sourceHeight)return DXGI_ERROR_ACCESS_LOST;
            auto access=newest.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();ComPtr<ID3D11Texture2D> texture;
            hr=access->GetInterface(IID_PPV_ARGS(&texture));if(FAILED(hr))return hr;
            D3D11_TEXTURE2D_DESC desc{};texture->GetDesc(&desc);desc.BindFlags=0;desc.MiscFlags=0;
            if(!e->latest)hr=e->device->CreateTexture2D(&desc,nullptr,&e->latest);
            if(FAILED(hr))return hr;
            e->context->CopyResource(e->latest.Get(),texture.Get());e->refresh=true;newest.Close();
        }
        if (!e->refresh || !e->latest) return S_FALSE;
        const int64_t elapsed=now.QuadPart-e->origin.QuadPart;
        const int64_t timestamp=(elapsed/e->frequency.QuadPart)*10000000+(elapsed%e->frequency.QuadPart)*10000000/e->frequency.QuadPart;
        ComPtr<IMFSample> sample; hr=convert(e,e->latest.Get(),&sample,timestamp);
        if(FAILED(hr))return hr;
        hr=e->encoder->ProcessInput(0,sample.Get(),0);
        if(hr==MF_E_NOTACCEPTING)return S_FALSE;
        if(FAILED(hr))return hr;
        e->inputCredits--; e->refresh=false; e->inFlight++;
        const int64_t interval=e->frequency.QuadPart/e->fps;
        // Preserve the frame clock through small scheduler delays. A long stall
        // resets it instead of queuing a burst of obsolete catch-up frames.
        e->nextInput.QuadPart=e->nextInput.QuadPart && now.QuadPart-e->nextInput.QuadPart<interval
            ? e->nextInput.QuadPart+interval : now.QuadPart+interval;
        return S_FALSE;
    };
    try{e->error=run();}catch(const winrt::hresult_error& error){e->error=error.code();}catch(...){e->error=E_FAIL;}
    if(FAILED(e->error)){e->stop();return -1;} return frame->bytes;
}
__declspec(dllexport) int mew_gpu_keyframe(void* handle) {
    auto e=static_cast<Engine*>(handle); if(!e || !e->active)return -1;
    e->refresh=true; return SUCCEEDED(e->value(CODECAPI_AVEncVideoForceKeyFrame,1)) ? 0 : -1;
}
__declspec(dllexport) int mew_gpu_bitrate(void* handle,int bitrate) {
    auto e=static_cast<Engine*>(handle); if(!e || !e->active || bitrate<350000 || bitrate>20000000)return -1;
    return SUCCEEDED(e->value(CODECAPI_AVEncCommonMeanBitRate,bitrate)) ? 0 : -1;
}
__declspec(dllexport) uint32_t mew_gpu_error(void* handle) { auto e=static_cast<Engine*>(handle);return e ? static_cast<uint32_t>(e->error) : static_cast<uint32_t>(E_POINTER); }
__declspec(dllexport) void mew_gpu_stop(void* handle) { auto e=static_cast<Engine*>(handle); if(e)e->stop(); }
__declspec(dllexport) void mew_gpu_destroy(void* handle) { delete static_cast<Engine*>(handle); }
}
