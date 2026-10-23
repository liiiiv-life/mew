// Best-effort, silent host notice. No GPU work, polling, app registration or elevation.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <cwchar>

static DWORD WINAPI noticeThread(void* value) {
    HANDLE cancelled=static_cast<HANDLE>(value);
    if(WaitForSingleObject(cancelled,0)!=WAIT_TIMEOUT){CloseHandle(cancelled);return 0;}
    HWND window=CreateWindowExW(0,L"STATIC",L"mew",0,0,0,0,0,HWND_MESSAGE,nullptr,GetModuleHandleW(nullptr),nullptr);
    if(!window){CloseHandle(cancelled);return 0;}
    NOTIFYICONDATAW icon{};icon.cbSize=sizeof(icon);icon.hWnd=window;icon.uID=1;
    icon.uFlags=NIF_ICON|NIF_TIP;icon.hIcon=LoadIconW(nullptr,IDI_APPLICATION);
    wcscpy_s(icon.szTip,L"mew");
    bool added=WaitForSingleObject(cancelled,0)==WAIT_TIMEOUT&&Shell_NotifyIconW(NIM_ADD,&icon);
    if(added){
        icon.uVersion=NOTIFYICON_VERSION_4;Shell_NotifyIconW(NIM_SETVERSION,&icon);
        icon.uFlags=NIF_INFO|NIF_REALTIME;
        icon.dwInfoFlags=NIIF_INFO|NIIF_NOSOUND|NIIF_RESPECT_QUIET_TIME;
        wcscpy_s(icon.szInfoTitle,L"mew 원격 데스크톱 연결됨");
        wcscpy_s(icon.szInfo,L"이 PC에 원격으로 연결되었습니다.");
        if(WaitForSingleObject(cancelled,0)==WAIT_TIMEOUT)Shell_NotifyIconW(NIM_MODIFY,&icon);
        // The OS chooses the display duration. Bound our hidden window/icon lifetime.
        const ULONGLONG until=GetTickCount64()+30000;
        for(;;){
            const ULONGLONG now=GetTickCount64();if(now>=until)break;
            DWORD remaining=static_cast<DWORD>(until-now);
            if(MsgWaitForMultipleObjects(1,&cancelled,FALSE,remaining,QS_ALLINPUT)!=WAIT_OBJECT_0+1)break;
            MSG message{};
            while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){TranslateMessage(&message);DispatchMessageW(&message);}
        }
        Shell_NotifyIconW(NIM_DELETE,&icon);
    }
    DestroyWindow(window);CloseHandle(cancelled);return 0;
}

extern "C" __declspec(dllexport) void* mew_notice_start() {
    // Pin the module: the notification thread can briefly outlive the JS binding.
    HMODULE module=nullptr;
    if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&noticeThread),&module))return nullptr;
    HANDLE cancelled=CreateEventW(nullptr,TRUE,FALSE,nullptr),owned=nullptr;
    if(!cancelled)return nullptr;
    if(!DuplicateHandle(GetCurrentProcess(),cancelled,GetCurrentProcess(),&owned,0,FALSE,DUPLICATE_SAME_ACCESS)){
        CloseHandle(cancelled);return nullptr;
    }
    HANDLE thread=CreateThread(nullptr,0,noticeThread,owned,0,nullptr);
    if(!thread){CloseHandle(owned);CloseHandle(cancelled);return nullptr;}
    CloseHandle(thread);return cancelled;
}

extern "C" __declspec(dllexport) void mew_notice_stop(void* value) {
    if(value){SetEvent(static_cast<HANDLE>(value));CloseHandle(static_cast<HANDLE>(value));}
}
