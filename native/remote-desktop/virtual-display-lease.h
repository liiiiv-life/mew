#pragma once
#include <cstdint>

// Used under the driver's mutex. Time comes from GetTickCount64, never wall time.
struct DisplayLease {
    uintptr_t owner = 0;
    uint64_t touched = 0;
    static constexpr uint64_t timeout = 10000;
    bool acquire(uintptr_t file, uint64_t now) {
        if (!file || owner) return false;
        owner=file; touched=now; return true;
    }
    bool renew(uintptr_t file, uint64_t now) {
        if (!file || owner!=file || expired(now)) return false;
        touched=now; return true;
    }
    bool expired(uint64_t now) const { return owner && now-touched>=timeout; }
    bool release(uintptr_t file) {
        if (!file || owner!=file) return false;
        owner=0; touched=0; return true;
    }
};
