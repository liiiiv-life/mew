//! 협업 방의 CRDT 상태(yrs Doc)와 그 위의 최소 연산만 담는다. ADR 0035.
//!
//! 여기 없는 것 — 일부러 Node에 남겨둔 것들이다:
//! - WebSocket 업그레이드·인증(`server/reqAuth.ts`의 authorizeCollab). 인증 경계는 옮기지 않는다.
//! - sync 메시지 봉투(varUint 타입 + varUint8Array 본문) 인코딩. `server/syncCodec.ts`가 한다.
//! - awareness. CRDT가 아니라 clock+JSON 맵이라 Rust로 올 이유가 없다.
//! - 방 수 상한·클라이언트 맵·생명주기 훅.
//!
//! 즉 이 크레이트의 계약은 "상태 벡터를 주고, diff를 인코딩하고, 업데이트를 적용해 새로 생긴
//! diff를 돌려준다" 셋뿐이다.

use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Subscription, Transact, Update};

fn to_err(msg: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, msg.to_string())
}

#[napi]
pub struct CollabDoc {
    doc: Doc,
    /// apply_update 한 번이 만들어낸 업데이트 바이트. 관찰자가 채우고 호출자가 비운다.
    ///
    /// 상태 벡터 diff로 계산하지 않는 이유: 상태 벡터는 삭제(delete set)를 담지 않으므로
    /// "삭제만 있는 업데이트"를 빈 diff로 오판해 브로드캐스트를 빠뜨릴 수 있다. Yjs 서버가
    /// doc.on('update')로 하는 것과 같은 방식을 쓴다.
    pending: Arc<Mutex<Vec<u8>>>,
    _sub: Subscription,
}

#[napi]
impl CollabDoc {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let doc = Doc::new();
        let pending = Arc::new(Mutex::new(Vec::new()));
        let sink = pending.clone();
        let sub = doc
            .observe_update_v1(move |_txn, event| {
                if let Ok(mut buf) = sink.lock() {
                    // 한 트랜잭션에서 여러 번 불릴 수 있으니 이어 붙인다. Yjs 업데이트는
                    // 이어 붙인 것도 유효한 업데이트다.
                    buf.extend_from_slice(&event.update);
                }
            })
            .map_err(to_err)?;
        Ok(Self { doc, pending, _sub: sub })
    }

    /// sync step1에 실어 보낼 내 상태 벡터
    #[napi]
    pub fn state_vector(&self) -> Result<Buffer> {
        let txn = self.doc.transact();
        Ok(Buffer::from(txn.state_vector().encode_v1()))
    }

    /// sync step2에 실어 보낼 업데이트. state_vector가 없으면 전체 상태.
    #[napi]
    pub fn encode_state_as_update(&self, state_vector: Option<Buffer>) -> Result<Buffer> {
        let sv = match state_vector {
            // 깨진 상태 벡터로 전체 상태를 흘리지 않는다 — 상대가 보낸 값이 이상하면 에러다.
            Some(bytes) => StateVector::decode_v1(&bytes).map_err(to_err)?,
            None => StateVector::default(),
        };
        let txn = self.doc.transact();
        Ok(Buffer::from(txn.encode_state_as_update_v1(&sv)))
    }

    /// 업데이트를 적용하고, 그 결과 방이 새로 얻은 업데이트를 돌려준다(브로드캐스트용).
    /// 이미 알고 있던 내용뿐이면 None — 그때는 보낼 것이 없다.
    #[napi]
    pub fn apply_update(&self, update: Buffer) -> Result<Option<Buffer>> {
        let parsed = Update::decode_v1(&update).map_err(to_err)?;
        {
            let mut txn = self.doc.transact_mut();
            txn.apply_update(parsed).map_err(to_err)?;
        } // 관찰자는 트랜잭션이 끝날 때 불리므로, 여기서 스코프를 닫고 나서 읽는다
        let mut buf = self.pending.lock().map_err(to_err)?;
        if buf.is_empty() {
            return Ok(None);
        }
        Ok(Some(Buffer::from(std::mem::take(&mut *buf))))
    }
}
