import { useState } from 'react'
export default function Chats({ onOpen }:{ onOpen:(peerId:string)=>void }){
  const [peer, setPeer] = useState('')
  return (
    <div style={{padding:16}}>
      <h2>GhostComms • NoEU</h2>
      <p>Enter a peer Device ID to start a thread (MVP).</p>
      <form onSubmit={e=>{e.preventDefault(); if(peer) onOpen(peer)}}>
        <input value={peer} onChange={e=>setPeer(e.target.value)} placeholder="Peer deviceId" style={{padding:10, borderRadius:8, border:'1px solid #ccc', width:'100%'}} />
      </form>
    </div>
  )
}
