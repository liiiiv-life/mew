#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <cstdio>
#include <cwchar>

// CreateProcess uses CRT argument parsing. Preserve quotes and trailing slashes.
static std::wstring quote(const wchar_t* value) {
    std::wstring out = L"\"";
    unsigned slashes = 0;
    for (const wchar_t* p = value; *p; ++p) {
        if (*p == L'\\') { ++slashes; continue; }
        out.append(slashes * (*p == L'\"' ? 2 : 1), L'\\');
        slashes = 0;
        if (*p == L'\"') out += L'\\';
        out += *p;
    }
    out.append(slashes * 2, L'\\');
    return out + L'\"';
}

static BOOL WINAPI control(DWORD event) { return event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT; }

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) { std::fputs("Missing process command\n", stderr); return 2; }
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) return 125;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // Limit this owned tree, never a shared OS job containing unrelated programs.
    wchar_t memoryMode[32]{};
    GetEnvironmentVariableW(L"MEW_AGENT_MEMORY_SCOPE", memoryMode, 32);
    MEMORYSTATUSEX memory{}; memory.dwLength = sizeof(memory);
    if (std::wstring(memoryMode) != L"off") {
        if (!GlobalMemoryStatusEx(&memory)) { CloseHandle(job); return 125; }
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
        limits.JobMemoryLimit = static_cast<SIZE_T>(memory.ullAvailPhys * 9 / 10);
    }
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) { CloseHandle(job); return 125; }
    SetConsoleCtrlHandler(control, TRUE);
    bool verbatim = false;
    int start = 1;
    HANDLE parent = nullptr;
    while (start < argc) {
        const std::wstring flag(argv[start]);
        if (flag == L"--verbatim") { verbatim = true; ++start; }
        else if (flag == L"--parent-pid" && start + 1 < argc) {
            wchar_t* end = nullptr;
            const unsigned long pid = std::wcstoul(argv[start + 1], &end, 10);
            if (!end || *end || pid <= 1 || parent) { CloseHandle(job); return 2; }
            parent = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(pid));
            if (!parent) { CloseHandle(job); return 125; }
            start += 2;
        } else break;
    }
    if (argc <= start) { CloseHandle(job); return 2; }
    std::wstring command = quote(argv[start]);
    for (int i = start + 1; i < argc; ++i) { command += L' '; command += verbatim ? argv[i] : quote(argv[i]); }
    std::vector<wchar_t> buffer(command.begin(), command.end()); buffer.push_back(0);
    STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW; startup.wShowWindow = SW_HIDE;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION child{};
    // Suspend first: no child can escape before the job has been assigned.
    if (!CreateProcessW(nullptr, buffer.data(), nullptr, nullptr, TRUE, CREATE_SUSPENDED, nullptr, nullptr, &startup, &child)) { CloseHandle(job); return 126; }
    if (!AssignProcessToJobObject(job, child.hProcess)) {
        TerminateProcess(child.hProcess, 125); CloseHandle(child.hThread); CloseHandle(child.hProcess); CloseHandle(job); return 125;
    }
    if (ResumeThread(child.hThread) == static_cast<DWORD>(-1)) {
        TerminateProcess(child.hProcess, 125); CloseHandle(child.hThread); CloseHandle(child.hProcess); CloseHandle(job); return 125;
    }
    CloseHandle(child.hThread);
    HANDLE handles[] = { child.hProcess, parent };
    const DWORD waited = WaitForMultipleObjects(parent ? 2 : 1, handles, FALSE, INFINITE);
    if (parent) CloseHandle(parent);
    if (waited != WAIT_OBJECT_0) { CloseHandle(child.hProcess); CloseHandle(job); return 125; }
    DWORD code = 1; GetExitCodeProcess(child.hProcess, &code);
    CloseHandle(child.hProcess); CloseHandle(job);
    return static_cast<int>(code);
}
