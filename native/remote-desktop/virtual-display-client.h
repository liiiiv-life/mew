#pragma once
#include <setupapi.h>
#include <vector>
#include <string>
#include <algorithm>
#include "virtual-display-protocol.h"

static HANDLE openMewDisplay() {
    HDEVINFO devices=SetupDiGetClassDevsW(&mewDisplayInterface,nullptr,nullptr,DIGCF_PRESENT|DIGCF_DEVICEINTERFACE);
    if(devices==INVALID_HANDLE_VALUE)return INVALID_HANDLE_VALUE;
    HANDLE result=INVALID_HANDLE_VALUE;
    SP_DEVICE_INTERFACE_DATA entry{};entry.cbSize=sizeof(entry);
    if(SetupDiEnumDeviceInterfaces(devices,nullptr,&mewDisplayInterface,0,&entry)) {
        DWORD bytes=0;SetupDiGetDeviceInterfaceDetailW(devices,&entry,nullptr,0,&bytes,nullptr);
        if(bytes>=sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W) && bytes<=64*1024) {
            std::vector<BYTE> storage(bytes);
            auto detail=reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(storage.data());detail->cbSize=sizeof(*detail);
            if(SetupDiGetDeviceInterfaceDetailW(devices,&entry,detail,bytes,nullptr,nullptr))
                result=CreateFileW(detail->DevicePath,GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,0,nullptr);
        }
    }
    SetupDiDestroyDeviceInfoList(devices);return result;
}
static bool mewTarget(const DISPLAYCONFIG_PATH_INFO& path) {
    DISPLAYCONFIG_TARGET_DEVICE_NAME name{};name.header.size=sizeof(name);name.header.type=DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
    name.header.adapterId=path.targetInfo.adapterId;name.header.id=path.targetInfo.id;
    if(DisplayConfigGetDeviceInfo(&name.header)!=ERROR_SUCCESS)return false;
    std::wstring value=name.monitorDevicePath;
    std::transform(value.begin(),value.end(),value.begin(),towupper);
    return value.find(L"MEW0001")!=std::wstring::npos;
}
static LONG mewDisplayPaths(UINT flags,std::vector<DISPLAYCONFIG_PATH_INFO>& paths,std::vector<DISPLAYCONFIG_MODE_INFO>& modes) {
    for(int attempt=0;attempt<4;attempt++) {
        UINT32 count=0,modeCount=0;LONG status=GetDisplayConfigBufferSizes(flags,&count,&modeCount);
        if(status!=ERROR_SUCCESS)return status;
        if(count>4096 || modeCount>16384)return ERROR_INVALID_DATA;
        paths.resize(std::max<UINT32>(1,count));modes.resize(std::max<UINT32>(1,modeCount));
        status=QueryDisplayConfig(flags,&count,paths.data(),&modeCount,modes.data(),nullptr);
        if(status==ERROR_INSUFFICIENT_BUFFER)continue;
        if(status==ERROR_SUCCESS){paths.resize(count);modes.resize(modeCount);}return status;
    }
    return ERROR_INSUFFICIENT_BUFFER;
}
// Preserve each existing active path; add only our monitor, without saving a new
// persistent layout or selecting a different primary screen.
static LONG activateMewDisplay() {
    std::vector<DISPLAYCONFIG_PATH_INFO> paths;std::vector<DISPLAYCONFIG_MODE_INFO> modes;
    LONG status=mewDisplayPaths(QDC_ALL_PATHS,paths,modes);if(status!=ERROR_SUCCESS)return status;
    std::vector<DISPLAYCONFIG_PATH_INFO> active;
    DISPLAYCONFIG_PATH_INFO added{};bool found=false;
    for(const auto& path:paths) {
        if(path.flags&DISPLAYCONFIG_PATH_ACTIVE)active.push_back(path);
        if(mewTarget(path)) {
            if(path.flags&DISPLAYCONFIG_PATH_ACTIVE)return ERROR_SUCCESS;
            added=path;found=true;
        }
    }
    if(!found)return ERROR_NOT_FOUND;
    added.flags=DISPLAYCONFIG_PATH_ACTIVE;
    added.sourceInfo.modeInfoIdx=DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
    added.targetInfo.modeInfoIdx=DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
    added.targetInfo.refreshRate={60,1};active.push_back(added);
    return SetDisplayConfig(static_cast<UINT32>(active.size()),active.data(),static_cast<UINT32>(modes.size()),modes.data(),
        SDC_USE_SUPPLIED_DISPLAY_CONFIG|SDC_APPLY|SDC_ALLOW_CHANGES);
}
static HMONITOR findMewMonitor() {
    std::vector<DISPLAYCONFIG_PATH_INFO> paths;std::vector<DISPLAYCONFIG_MODE_INFO> modes;
    if(mewDisplayPaths(QDC_ONLY_ACTIVE_PATHS,paths,modes)!=ERROR_SUCCESS)return nullptr;
    for(const auto& path:paths) {
        if(!mewTarget(path))continue;
        DISPLAYCONFIG_SOURCE_DEVICE_NAME source{};source.header.size=sizeof(source);source.header.type=DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        source.header.adapterId=path.sourceInfo.adapterId;source.header.id=path.sourceInfo.id;
        if(DisplayConfigGetDeviceInfo(&source.header)!=ERROR_SUCCESS)continue;
        struct Search { const wchar_t* name;HMONITOR result; } search{source.viewGdiDeviceName,nullptr};
        EnumDisplayMonitors(nullptr,nullptr,[](HMONITOR monitor,HDC,LPRECT,LPARAM data)->BOOL {
            auto query=reinterpret_cast<Search*>(data);MONITORINFOEXW info{};info.cbSize=sizeof(info);
            if(GetMonitorInfoW(monitor,&info) && !_wcsicmp(info.szDevice,query->name)){query->result=monitor;return FALSE;}return TRUE;
        },reinterpret_cast<LPARAM>(&search));
        if(search.result)return search.result;
    }
    return nullptr;
}
