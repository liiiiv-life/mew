// Mew's independent UMDF 2 / IddCx virtual monitor.
// DDI and swapchain structure adapted from Microsoft's MIT IndirectDisplay sample.
// Copyright (c) Microsoft Corporation. Modifications copyright (c) Mew contributors.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bugcodes.h>
#include <wudfwdm.h>
#include <wdf.h>
#include <iddcx.h>
#include <d3d11.h>
#include <dxgi1_5.h>
#include <wrl/client.h>
#include <memory>
#include <mutex>
#include <atomic>
#include <array>
#include "virtual-display-protocol.h"
#include "virtual-display-lease.h"

using Microsoft::WRL::ComPtr;
struct Device;
struct Swapchain {
    IDDCX_SWAPCHAIN chain;
    HANDLE available, stop=nullptr, thread=nullptr;
    ComPtr<ID3D11Device> device;
    ~Swapchain() {
        if(stop)SetEvent(stop);
        if(thread){WaitForSingleObject(thread,INFINITE);CloseHandle(thread);}
        else if(chain)WdfObjectDelete(chain);
        if(stop)CloseHandle(stop);
    }
    static DWORD WINAPI run(void* value) {
        auto self=static_cast<Swapchain*>(value);
        ComPtr<IDXGIDevice> dxgi; HRESULT hr=self->device.As(&dxgi);
        IDARG_IN_SWAPCHAINSETDEVICE set{}; set.pDevice=dxgi.Get();
        if(SUCCEEDED(hr))hr=IddCxSwapChainSetDevice(self->chain,&set);
        while(SUCCEEDED(hr) && WaitForSingleObject(self->stop,0)!=WAIT_OBJECT_0) {
            IDARG_OUT_RELEASEANDACQUIREBUFFER buffer{};
            hr=IddCxSwapChainReleaseAndAcquireBuffer(self->chain,&buffer);
            if(hr==E_PENDING) {
                HANDLE waits[]={self->stop,self->available};
                if(WaitForMultipleObjects(2,waits,FALSE,INFINITE)!=WAIT_OBJECT_0+1)break;
                hr=S_OK; continue;
            }
            if(FAILED(hr))break;
            // Desktop composition stays on the selected GPU. WGC captures it
            // in the authorized user session; no CPU map or raw frame pipe.
            ComPtr<IDXGIResource> surface; surface.Attach(buffer.MetaData.pSurface);
            surface.Reset(); hr=IddCxSwapChainFinishedProcessingFrame(self->chain);
        }
        WdfObjectDelete(self->chain); self->chain=nullptr; return 0;
    }
    bool start(LUID render) {
        ComPtr<IDXGIFactory4> factory; ComPtr<IDXGIAdapter> adapter;
        HRESULT hr=CreateDXGIFactory1(IID_PPV_ARGS(&factory));
        if(SUCCEEDED(hr))hr=factory->EnumAdapterByLuid(render,IID_PPV_ARGS(&adapter));
        if(SUCCEEDED(hr))hr=D3D11CreateDevice(adapter.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&device,nullptr,nullptr);
        if(FAILED(hr))return false;
        stop=CreateEventW(nullptr,TRUE,FALSE,nullptr); if(!stop)return false;
        thread=CreateThread(nullptr,0,run,this,0,nullptr); return thread!=nullptr;
    }
};
struct Monitor {
    std::mutex mutex;
    std::unique_ptr<Swapchain> swapchain;
    std::atomic<uint64_t> render{0};
    uint64_t generation=0;
    bool retiring=false;
};
struct Device {
    WDFDEVICE device=nullptr;
    IDDCX_ADAPTER adapter=nullptr;
    IDDCX_MONITOR monitor=nullptr;
    WDFTIMER timer=nullptr;
    std::mutex mutex;
    DisplayLease lease;
    bool ready=false;
    NTSTATUS remove();
};
struct DevicePointer { Device* value; };
struct MonitorPointer { Monitor* value; };
WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(DevicePointer, getDevice);
WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(MonitorPointer, getMonitor);

NTSTATUS Device::remove() {
    lease={};if(!monitor)return STATUS_SUCCESS;
    auto state=getMonitor(monitor)->value;std::unique_ptr<Swapchain> previous;
    {std::lock_guard<std::mutex> lock(state->mutex);state->retiring=true;previous=std::move(state->swapchain);state->render=0;++state->generation;}
    // Stop the worker before departure destroys its parent monitor context.
    previous.reset();NTSTATUS status=IddCxMonitorDeparture(monitor);
    if(NT_SUCCESS(status))monitor=nullptr;return status;
}

// Stable synthetic 1080p EDID, not copied from a physical monitor vendor.
static constexpr std::array<BYTE,128> edid() {
    std::array<BYTE,128> e{};
    e[0]=0;e[1]=e[2]=e[3]=e[4]=e[5]=e[6]=255;e[7]=0;
    e[8]=0x34;e[9]=0xb7;e[10]=1;e[12]=1;e[16]=1;e[17]=36;
    e[18]=1;e[19]=4;e[20]=0x80;e[21]=51;e[22]=29;e[23]=120;e[24]=0x06;
    for(int i=38;i<54;i++)e[i]=1;
    const BYTE timing[]={0x02,0x3a,0x80,0x18,0x71,0x38,0x2d,0x40,0x58,0x2c,0x45,0x00,0xfe,0x22,0x11,0x00,0x00,0x1e};
    for(int i=0;i<18;i++)e[54+i]=timing[i];
    e[75]=0xfc;const char name[]="Mew Display\n ";for(int i=0;i<13;i++)e[77+i]=name[i];
    e[93]=0x10;e[111]=0x10;
    unsigned sum=0;for(int i=0;i<127;i++)sum+=e[i];e[127]=static_cast<BYTE>(0-sum);return e;
}
static constexpr auto monitorEdid=edid();
static void signal(DISPLAYCONFIG_VIDEO_SIGNAL_INFO& value,bool monitor) {
    value={};value.activeSize={1920,1080};value.totalSize={2200,1125};
    value.pixelRate=148500000;value.hSyncFreq={67500,1};value.vSyncFreq={60,1};
    value.AdditionalSignalInfo.vSyncFreqDivider=monitor?0:1;value.AdditionalSignalInfo.videoStandard=255;
    value.scanLineOrdering=DISPLAYCONFIG_SCANLINE_ORDERING_PROGRESSIVE;
}
EVT_WDF_DRIVER_DEVICE_ADD addDevice;
EVT_WDF_DEVICE_D0_ENTRY powerOn;
EVT_WDF_DEVICE_D0_EXIT powerOff;
EVT_WDF_FILE_CLEANUP fileCleanup;
EVT_WDF_TIMER tick;
EVT_IDD_CX_DEVICE_IO_CONTROL control;
EVT_IDD_CX_ADAPTER_INIT_FINISHED adapterReady;
EVT_IDD_CX_ADAPTER_COMMIT_MODES commitModes;
EVT_IDD_CX_PARSE_MONITOR_DESCRIPTION parseModes;
EVT_IDD_CX_MONITOR_GET_DEFAULT_DESCRIPTION_MODES defaultModes;
EVT_IDD_CX_MONITOR_QUERY_TARGET_MODES targetModes;
EVT_IDD_CX_MONITOR_ASSIGN_SWAPCHAIN assign;
EVT_IDD_CX_MONITOR_UNASSIGN_SWAPCHAIN unassign;

extern "C" DRIVER_INITIALIZE DriverEntry;
extern "C" BOOL WINAPI DllMain(HINSTANCE,DWORD,LPVOID){return TRUE;}
extern "C" NTSTATUS DriverEntry(PDRIVER_OBJECT driver,PUNICODE_STRING path) {
    WDF_DRIVER_CONFIG config;WDF_DRIVER_CONFIG_INIT(&config,addDevice);
    return WdfDriverCreate(driver,path,WDF_NO_OBJECT_ATTRIBUTES,&config,WDF_NO_HANDLE);
}
NTSTATUS addDevice(WDFDRIVER,PWDFDEVICE_INIT init) {
    WDF_PNPPOWER_EVENT_CALLBACKS power;WDF_PNPPOWER_EVENT_CALLBACKS_INIT(&power);
    power.EvtDeviceD0Entry=powerOn;power.EvtDeviceD0Exit=powerOff;
    WdfDeviceInitSetPnpPowerEventCallbacks(init,&power);
    WDF_FILEOBJECT_CONFIG files;WDF_FILEOBJECT_CONFIG_INIT(&files,WDF_NO_EVENT_CALLBACK,WDF_NO_EVENT_CALLBACK,fileCleanup);
    WdfDeviceInitSetFileObjectConfig(init,&files,WDF_NO_OBJECT_ATTRIBUTES);
    IDD_CX_CLIENT_CONFIG client;IDD_CX_CLIENT_CONFIG_INIT(&client);
    client.EvtIddCxDeviceIoControl=control;client.EvtIddCxAdapterInitFinished=adapterReady;
    client.EvtIddCxAdapterCommitModes=commitModes;client.EvtIddCxParseMonitorDescription=parseModes;
    client.EvtIddCxMonitorGetDefaultDescriptionModes=defaultModes;client.EvtIddCxMonitorQueryTargetModes=targetModes;
    client.EvtIddCxMonitorAssignSwapChain=assign;client.EvtIddCxMonitorUnassignSwapChain=unassign;
    NTSTATUS status=IddCxDeviceInitConfig(init,&client);if(!NT_SUCCESS(status))return status;
    WDF_OBJECT_ATTRIBUTES attr;WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attr,DevicePointer);
    attr.EvtDestroyCallback=[](WDFOBJECT object){delete getDevice(object)->value;};
    WDFDEVICE object;status=WdfDeviceCreate(&init,&attr,&object);if(!NT_SUCCESS(status))return status;
    auto state=new Device;getDevice(object)->value=state;state->device=object;
    status=IddCxDeviceInitialize(object);if(!NT_SUCCESS(status))return status;
    status=WdfDeviceCreateDeviceInterface(object,&mewDisplayInterface,nullptr);if(!NT_SUCCESS(status))return status;
    WDF_TIMER_CONFIG timer;WDF_TIMER_CONFIG_INIT(&timer,tick);timer.AutomaticSerialization=FALSE;
    WDF_OBJECT_ATTRIBUTES_INIT(&attr);attr.ParentObject=object;
    return WdfTimerCreate(&timer,&attr,&state->timer);
}
NTSTATUS powerOn(WDFDEVICE object,WDF_POWER_DEVICE_STATE) {
    auto state=getDevice(object)->value;
    if(state->adapter)return STATUS_SUCCESS;
    IDDCX_ADAPTER_CAPS caps{};caps.Size=sizeof(caps);caps.MaxMonitorsSupported=1;
    auto& d=caps.EndPointDiagnostics;d.Size=sizeof(d);d.GammaSupport=IDDCX_FEATURE_IMPLEMENTATION_NONE;
    d.TransmissionType=IDDCX_TRANSMISSION_TYPE_WIRED_OTHER;
    d.pEndPointFriendlyName=L"Mew Virtual Display";d.pEndPointManufacturerName=L"Mew";d.pEndPointModelName=L"Mew Display";
    IDDCX_ENDPOINT_VERSION version{};version.Size=sizeof(version);version.MajorVer=1;
    d.pFirmwareVersion=&version;d.pHardwareVersion=&version;
    WDF_OBJECT_ATTRIBUTES attr;WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attr,DevicePointer);
    IDARG_IN_ADAPTER_INIT in{};in.WdfDevice=object;in.pCaps=&caps;in.ObjectAttributes=&attr;
    IDARG_OUT_ADAPTER_INIT out{};NTSTATUS status=IddCxAdapterInitAsync(&in,&out);
    if(NT_SUCCESS(status)){state->adapter=out.AdapterObject;getDevice(out.AdapterObject)->value=state;}
    return status;
}
NTSTATUS powerOff(WDFDEVICE object,WDF_POWER_DEVICE_STATE) {
    auto state=getDevice(object)->value;WdfTimerStop(state->timer,TRUE);
    std::lock_guard<std::mutex> lock(state->mutex);state->remove();return STATUS_SUCCESS;
}
NTSTATUS adapterReady(IDDCX_ADAPTER adapter,const IDARG_IN_ADAPTER_INIT_FINISHED* in) {
    auto state=getDevice(adapter)->value;std::lock_guard<std::mutex> lock(state->mutex);
    state->ready=NT_SUCCESS(in->AdapterInitStatus);return STATUS_SUCCESS;
}
void fileCleanup(WDFFILEOBJECT file) {
    auto state=getDevice(WdfFileObjectGetDevice(file))->value;
    std::lock_guard<std::mutex> lock(state->mutex);
    if(state->lease.owner==reinterpret_cast<uintptr_t>(file))state->remove();
}
void tick(WDFTIMER timer) {
    auto state=getDevice(WdfTimerGetParentObject(timer))->value;
    std::lock_guard<std::mutex> lock(state->mutex);
    if(state->lease.expired(GetTickCount64()) || (state->monitor && !state->lease.owner))state->remove();
    if(state->lease.owner || state->monitor)WdfTimerStart(timer,WDF_REL_TIMEOUT_IN_MS(1000));
}
void control(WDFDEVICE object,WDFREQUEST request,size_t output,size_t input,ULONG code) {
    auto state=getDevice(object)->value;std::lock_guard<std::mutex> lock(state->mutex);
    uintptr_t file=reinterpret_cast<uintptr_t>(WdfRequestGetFileObject(request));
    NTSTATUS status=STATUS_INVALID_DEVICE_REQUEST;size_t written=0;
    if(state->lease.expired(GetTickCount64()))state->remove();
    if(!file)status=STATUS_ACCESS_DENIED;
    else if(code==mewDisplayAcquire && input==sizeof(MewDisplayRequest) && !output) {
        MewDisplayRequest* data=nullptr;status=WdfRequestRetrieveInputBuffer(request,sizeof(*data),reinterpret_cast<void**>(&data),nullptr);
        if(NT_SUCCESS(status)) {
            if(data->version!=mewDisplayVersion)status=STATUS_REVISION_MISMATCH;
            else if(!state->ready)status=STATUS_DEVICE_NOT_READY;
            else if(state->monitor || !state->lease.acquire(file,GetTickCount64()))status=STATUS_DEVICE_BUSY;
            else {
                IDARG_IN_ADAPTERSETRENDERADAPTER render{};render.PreferredRenderAdapter=data->render;
                IddCxAdapterSetRenderAdapter(state->adapter,&render);
                WDF_OBJECT_ATTRIBUTES attr;WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attr,MonitorPointer);
                attr.EvtCleanupCallback=[](WDFOBJECT o){delete getMonitor(o)->value;getMonitor(o)->value=nullptr;};
                IDDCX_MONITOR_INFO info{};info.Size=sizeof(info);info.MonitorType=DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI;
                info.ConnectorIndex=0;info.MonitorContainerId=mewDisplayContainer;
                info.MonitorDescription.Size=sizeof(info.MonitorDescription);info.MonitorDescription.Type=IDDCX_MONITOR_DESCRIPTION_TYPE_EDID;
                info.MonitorDescription.DataSize=128;info.MonitorDescription.pData=const_cast<BYTE*>(monitorEdid.data());
                IDARG_IN_MONITORCREATE in{};in.ObjectAttributes=&attr;in.pMonitorInfo=&info;
                IDARG_OUT_MONITORCREATE out{};status=IddCxMonitorCreate(state->adapter,&in,&out);
                if(NT_SUCCESS(status)) {
                    state->monitor=out.MonitorObject;getMonitor(out.MonitorObject)->value=new Monitor;
                    IDARG_OUT_MONITORARRIVAL arrival{};status=IddCxMonitorArrival(out.MonitorObject,&arrival);
                    if(!NT_SUCCESS(status)){WdfObjectDelete(out.MonitorObject);state->monitor=nullptr;}
                }
                if(NT_SUCCESS(status))WdfTimerStart(state->timer,WDF_REL_TIMEOUT_IN_MS(1000));else state->lease={};
            }
        }
    } else if(code==mewDisplayRenew && !input && !output) {
        status=state->lease.renew(file,GetTickCount64())?STATUS_SUCCESS:STATUS_ACCESS_DENIED;
    } else if(code==mewDisplayRelease && !input && !output) {
        if(state->lease.owner==file)status=state->remove();else status=STATUS_ACCESS_DENIED;
    } else if(code==mewDisplayStatus && !input && output==sizeof(MewDisplayStatus)) {
        MewDisplayStatus* data=nullptr;status=WdfRequestRetrieveOutputBuffer(request,sizeof(*data),reinterpret_cast<void**>(&data),nullptr);
        if(NT_SUCCESS(status)) {
            *data={mewDisplayVersion,state->lease.owner==file?1u:0u,{}};
            if(state->monitor && data->active){uint64_t id=getMonitor(state->monitor)->value->render.load();memcpy(&data->render,&id,8);}
            written=sizeof(*data);
        }
    }
    WdfRequestCompleteWithInformation(request,status,written);
}
NTSTATUS commitModes(IDDCX_ADAPTER,const IDARG_IN_COMMITMODES*){return STATUS_SUCCESS;}
NTSTATUS parseModes(const IDARG_IN_PARSEMONITORDESCRIPTION* in,IDARG_OUT_PARSEMONITORDESCRIPTION* out) {
    if(in->MonitorDescription.DataSize!=128 || !in->MonitorDescription.pData || memcmp(in->MonitorDescription.pData,monitorEdid.data(),128))return STATUS_INVALID_PARAMETER;
    out->MonitorModeBufferOutputCount=1;out->PreferredMonitorModeIdx=0;
    if(!in->MonitorModeBufferInputCount)return STATUS_SUCCESS;
    if(!in->pMonitorModes)return STATUS_INVALID_PARAMETER;
    IDDCX_MONITOR_MODE mode{};mode.Size=sizeof(mode);mode.Origin=IDDCX_MONITOR_MODE_ORIGIN_MONITORDESCRIPTOR;
    signal(mode.MonitorVideoSignalInfo,true);in->pMonitorModes[0]=mode;return STATUS_SUCCESS;
}
NTSTATUS defaultModes(IDDCX_MONITOR,const IDARG_IN_GETDEFAULTDESCRIPTIONMODES* in,IDARG_OUT_GETDEFAULTDESCRIPTIONMODES* out) {
    out->DefaultMonitorModeBufferOutputCount=1;out->PreferredMonitorModeIdx=0;
    if(!in->DefaultMonitorModeBufferInputCount)return STATUS_SUCCESS;
    if(!in->pDefaultMonitorModes)return STATUS_INVALID_PARAMETER;
    IDDCX_MONITOR_MODE mode{};mode.Size=sizeof(mode);mode.Origin=IDDCX_MONITOR_MODE_ORIGIN_DRIVER;
    signal(mode.MonitorVideoSignalInfo,true);in->pDefaultMonitorModes[0]=mode;return STATUS_SUCCESS;
}
NTSTATUS targetModes(IDDCX_MONITOR,const IDARG_IN_QUERYTARGETMODES* in,IDARG_OUT_QUERYTARGETMODES* out) {
    out->TargetModeBufferOutputCount=1;if(!in->TargetModeBufferInputCount)return STATUS_SUCCESS;
    if(!in->pTargetModes)return STATUS_INVALID_PARAMETER;
    IDDCX_TARGET_MODE mode{};mode.Size=sizeof(mode);signal(mode.TargetVideoSignalInfo.targetVideoSignalInfo,false);
    in->pTargetModes[0]=mode;return STATUS_SUCCESS;
}
NTSTATUS assign(IDDCX_MONITOR object,const IDARG_IN_SETSWAPCHAIN* in) {
    auto state=getMonitor(object)->value;std::unique_ptr<Swapchain> previous;uint64_t generation;
    bool retiring;
    {std::lock_guard<std::mutex> lock(state->mutex);retiring=state->retiring;previous=std::move(state->swapchain);state->render=0;generation=++state->generation;}
    // Joining the processing thread / deleting a WDF swapchain must not hold
    // our monitor lock: IddCx can issue another callback during teardown.
    previous.reset();
    if(retiring){WdfObjectDelete(in->hSwapChain);return STATUS_SUCCESS;}
    auto next=std::make_unique<Swapchain>();next->chain=in->hSwapChain;next->available=in->hNextSurfaceAvailable;
    if(!next->start(in->RenderAdapterLuid))return STATUS_SUCCESS;
    uint64_t luid;memcpy(&luid,&in->RenderAdapterLuid,8);
    {std::lock_guard<std::mutex> lock(state->mutex);if(state->generation==generation && !state->retiring){state->render=luid;state->swapchain=std::move(next);}}
    return STATUS_SUCCESS;
}
NTSTATUS unassign(IDDCX_MONITOR object) {
    auto state=getMonitor(object)->value;std::unique_ptr<Swapchain> previous;
    {std::lock_guard<std::mutex> lock(state->mutex);previous=std::move(state->swapchain);state->render=0;++state->generation;}
    previous.reset();return STATUS_SUCCESS;
}
