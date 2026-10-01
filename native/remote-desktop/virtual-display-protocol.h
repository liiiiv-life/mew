#pragma once
#include <windows.h>
#include <winioctl.h>
#include <cstdint>

// Private, local device interface. No network listener or vendor driver protocol.
inline constexpr GUID mewDisplayInterface = {0x49e39a7d,0x8ff5,0x45ec,{0xae,0x54,0x8c,0x0a,0x38,0x04,0x65,0x98}};
inline constexpr GUID mewDisplayContainer = {0xdbb7f1de,0x6a40,0x4c9b,{0xb3,0xec,0x61,0x69,0xe1,0x57,0x21,0xac}};
inline constexpr wchar_t mewDisplayHardwareId[] = L"Root\\MewVirtualDisplay";
inline constexpr uint32_t mewDisplayVersion = 1;
inline constexpr DWORD mewDisplayAcquire = CTL_CODE(FILE_DEVICE_UNKNOWN,0x800,METHOD_BUFFERED,FILE_READ_ACCESS|FILE_WRITE_ACCESS);
inline constexpr DWORD mewDisplayRenew = CTL_CODE(FILE_DEVICE_UNKNOWN,0x801,METHOD_BUFFERED,FILE_READ_ACCESS|FILE_WRITE_ACCESS);
inline constexpr DWORD mewDisplayRelease = CTL_CODE(FILE_DEVICE_UNKNOWN,0x802,METHOD_BUFFERED,FILE_READ_ACCESS|FILE_WRITE_ACCESS);
inline constexpr DWORD mewDisplayStatus = CTL_CODE(FILE_DEVICE_UNKNOWN,0x803,METHOD_BUFFERED,FILE_READ_ACCESS|FILE_WRITE_ACCESS);
struct MewDisplayRequest { uint32_t version; LUID render; };
struct MewDisplayStatus { uint32_t version, active; LUID render; };
static_assert(sizeof(MewDisplayRequest)==12 && sizeof(MewDisplayStatus)==16);
