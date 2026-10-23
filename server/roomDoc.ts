// 협업 방의 CRDT 상태. 백엔드 둘 — 기본은 JS Yjs, `MEW_COLLAB_RUST=1`이면 Rust(yrs). ADR 0035.
//
// 인터페이스가 이 셋뿐인 이유: 방 서버가 CRDT에게 요구하는 것이 실제로 이것뿐이다. awareness·인증·
// 방 수 상한·클라이언트 맵은 백엔드와 무관하게 collab.ts에 남는다.
import * as Y from 'yjs'
import { createRequire } from 'node:module'

export interface RoomDoc {
  /** sync step1에 실을 내 상태 벡터 */
  stateVector(): Uint8Array
  /** sync step2에 실을 업데이트. 상태 벡터를 주면 그 기준 diff, 없으면 전체 상태. */
  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array
  /**
   * 업데이트를 적용하고, 그 결과 **방이 새로 얻은** 업데이트를 돌려준다(브로드캐스트용).
   * 이미 알던 내용뿐이면 null — 보낼 것이 없다.
   */
  applyUpdate(update: Uint8Array): Uint8Array | null
  destroy(): void
}

// 방 자신이 적용한 것과 외부에서 온 것을 구분할 필요는 없다 — 어느 쪽이든 새로 생긴 diff를
// 남은 클라이언트에게 보내야 하고, 보낸 상대만 collab.ts가 제외한다.
const APPLY_ORIGIN = Symbol('room-apply')

class YjsRoomDoc implements RoomDoc {
  private doc = new Y.Doc()
  private pending: Uint8Array[] = []

  constructor() {
    this.doc.on('update', (update: Uint8Array) => {
      this.pending.push(update)
    })
  }

  stateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc)
  }

  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, stateVector)
  }

  applyUpdate(update: Uint8Array): Uint8Array | null {
    this.pending = []
    Y.applyUpdate(this.doc, update, APPLY_ORIGIN)
    if (this.pending.length === 0) return null
    // 한 트랜잭션이 여러 번 'update'를 낼 수 있다 — 하나로 합쳐 프레임 하나로 보낸다
    return this.pending.length === 1 ? this.pending[0] : Y.mergeUpdates(this.pending)
  }

  destroy(): void {
    this.doc.destroy()
  }
}

interface NativeCollabDoc {
  stateVector(): Buffer
  encodeStateAsUpdate(stateVector?: Uint8Array): Buffer
  applyUpdate(update: Uint8Array): Buffer | null
}

let NativeCtor: (new () => NativeCollabDoc) | null = null

function loadNative(): new () => NativeCollabDoc {
  if (NativeCtor) return NativeCtor
  // 운영자가 명시적으로 Rust를 켰는데 로드가 안 되면 조용히 다른 백엔드로 돌지 않는다 —
  // 어느 구현이 돌고 있는지 모르는 상태가 협업 경로에서 제일 위험하다.
  const require = createRequire(import.meta.url)
  const mod = require('../native/collab/mew-collab.node') as { CollabDoc: new () => NativeCollabDoc }
  NativeCtor = mod.CollabDoc
  return NativeCtor
}

class RustRoomDoc implements RoomDoc {
  private inner: NativeCollabDoc

  constructor() {
    this.inner = new (loadNative())()
  }

  stateVector(): Uint8Array {
    return new Uint8Array(this.inner.stateVector())
  }

  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    return new Uint8Array(this.inner.encodeStateAsUpdate(stateVector))
  }

  applyUpdate(update: Uint8Array): Uint8Array | null {
    const diff = this.inner.applyUpdate(update)
    return diff ? new Uint8Array(diff) : null
  }

  destroy(): void {
    // yrs Doc은 GC가 회수한다 — 여기서 할 일이 없다. 참조를 끊어 방과 함께 놓아준다.
    this.inner = null as unknown as NativeCollabDoc
  }
}

/** 켜져 있는 백엔드 이름 — 로그·테스트가 어느 구현이 도는지 확인하는 데 쓴다 */
export function roomBackend(): 'yjs' | 'rust' {
  return process.env.MEW_COLLAB_RUST === '1' ? 'rust' : 'yjs'
}

export function createRoomDoc(): RoomDoc {
  return roomBackend() === 'rust' ? new RustRoomDoc() : new YjsRoomDoc()
}
