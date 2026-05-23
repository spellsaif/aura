import {
  getU8Encoder,
  getU16Encoder,
  getU32Encoder,
  getU64Encoder,
  getU128Encoder,
  getI8Encoder,
  getI16Encoder,
  getI32Encoder,
  getI64Encoder,
  getI128Encoder,
  getBooleanEncoder,
  getAddressEncoder,
  getUtf8Encoder,
  getArrayEncoder,
  getStructEncoder,
  getOptionEncoder,
  addEncoderSizePrefix,
  getU8Decoder,
  getU16Decoder,
  getU32Decoder,
  getU64Decoder,
  getU128Decoder,
  getI8Decoder,
  getI16Decoder,
  getI32Decoder,
  getI64Decoder,
  getI128Decoder,
  getBooleanDecoder,
  getAddressDecoder,
  getUtf8Decoder,
  getArrayDecoder,
  getStructDecoder,
  getOptionDecoder,
  addDecoderSizePrefix,
  AccountRole,
  Address,
  Instruction,
  TransactionSigner,
} from "@solana/kit"

/**
 * Dynamically calculate the 8-byte SHA-256 Anchor instruction discriminator.
 * Formula: sha256("global:<name>").slice(0, 8)
 */
export async function getInstructionDiscriminator(name: string): Promise<Uint8Array> {
  const input = `global:${name}`
  const msgUint8 = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8)
  return new Uint8Array(hashBuffer).subarray(0, 8)
}

/**
 * Dynamically calculate the 8-byte SHA-256 Anchor account discriminator.
 * Formula: sha256("account:<name>").slice(0, 8)
 */
export async function getAccountDiscriminator(name: string): Promise<Uint8Array> {
  const input = `account:${name}`
  const msgUint8 = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8)
  return new Uint8Array(hashBuffer).subarray(0, 8)
}

/**
 * Dynamically map an Anchor IDL type to its corresponding @solana/kit encoder.
 * Supports primitive types, options, vectors, defined types, and arrays.
 */
export function getEncoderForIdlType(type: any, idlTypes: any[] = []): any {
  if (typeof type === "string") {
    switch (type) {
      case "u8": return getU8Encoder()
      case "i8": return getI8Encoder()
      case "u16": return getU16Encoder()
      case "i16": return getI16Encoder()
      case "u32": return getU32Encoder()
      case "i32": return getI32Encoder()
      case "u64": return getU64Encoder()
      case "i64": return getI64Encoder()
      case "u128": return getU128Encoder()
      case "i128": return getI128Encoder()
      case "bool": return getBooleanEncoder()
      case "publicKey": return getAddressEncoder()
      case "string": return addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())
      case "bytes": return getArrayEncoder(getU8Encoder())
    }
  }

  if (typeof type === "object") {
    if (type.option) {
      const innerEncoder = getEncoderForIdlType(type.option, idlTypes)
      const baseOptionEncoder = getOptionEncoder(innerEncoder)
      return {
        encode(value: any) {
          if (value === null || value === undefined) {
            return baseOptionEncoder.encode({ __option: "None" })
          }
          return baseOptionEncoder.encode({ __option: "Some", value })
        }
      }
    }
    if (type.vec) {
      return getArrayEncoder(getEncoderForIdlType(type.vec, idlTypes))
    }
    if (type.array) {
      const [elemType, length] = type.array
      return getArrayEncoder(getEncoderForIdlType(elemType, idlTypes), { size: length })
    }
    if (type.defined) {
      const definedType = idlTypes.find((t: any) => t.name === type.defined)
      if (definedType) {
        return getEncoderForIdlType(definedType.type, idlTypes)
      }
    }
    if (type.kind === "struct") {
      const fields = type.fields.map((f: any) => [
        f.name,
        getEncoderForIdlType(f.type, idlTypes)
      ])
      return getStructEncoder(fields)
    }
    if (type.kind === "enum") {
      // Standard u8 discriminator fallback for simple flat enums
      return getU8Encoder()
    }
  }

  // Graceful Fallback: Return an encoder that accepts raw pre-serialized bytes
  return {
    encode(value: any) {
      if (value instanceof Uint8Array) return value
      throw new Error(
        `Unsupported IDL type: ${JSON.stringify(type)}. ` +
        `Please pass a pre-serialized Uint8Array instead.`
      )
    }
  }
}

/**
 * Dynamically map an Anchor IDL type to its corresponding @solana/kit decoder.
 * Supports primitive types, options, vectors, defined types, and arrays.
 */
export function getDecoderForIdlType(type: any, idlTypes: any[] = []): any {
  if (typeof type === "string") {
    switch (type) {
      case "u8": return getU8Decoder()
      case "i8": return getI8Decoder()
      case "u16": return getU16Decoder()
      case "i16": return getI16Decoder()
      case "u32": return getU32Decoder()
      case "i32": return getI32Decoder()
      case "u64": return getU64Decoder()
      case "i64": return getI64Decoder()
      case "u128": return getU128Decoder()
      case "i128": return getI128Decoder()
      case "bool": return getBooleanDecoder()
      case "publicKey": return getAddressDecoder()
      case "string": return addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())
      case "bytes": return getArrayDecoder(getU8Decoder())
    }
  }

  if (typeof type === "object") {
    if (type.option) {
      const innerDecoder = getDecoderForIdlType(type.option, idlTypes)
      const baseOptionDecoder = getOptionDecoder(innerDecoder)
      return {
        decode(bytes: Uint8Array, offset?: number) {
          const result = baseOptionDecoder.decode(bytes, offset)
          // Unwrap standard Anchor option types to clean JavaScript null or value
          if (result && typeof result === "object" && "__option" in result) {
            const opt = result as any
            if (opt.__option === "None") return null
            if (opt.__option === "Some") return opt.value
          }
          return result
        }
      }
    }
    if (type.vec) {
      return getArrayDecoder(getDecoderForIdlType(type.vec, idlTypes))
    }
    if (type.array) {
      const [elemType, length] = type.array
      return getArrayDecoder(getDecoderForIdlType(elemType, idlTypes), { size: length })
    }
    if (type.defined) {
      const definedType = idlTypes.find((t: any) => t.name === type.defined)
      if (definedType) {
        return getDecoderForIdlType(definedType.type, idlTypes)
      }
    }
    if (type.kind === "struct") {
      const fields = type.fields.map((f: any) => [
        f.name,
        getDecoderForIdlType(f.type, idlTypes)
      ])
      return getStructDecoder(fields)
    }
    if (type.kind === "enum") {
      return getU8Decoder()
    }
  }

  // Graceful Fallback: Return raw bytes
  return {
    decode(bytes: Uint8Array) {
      return bytes
    }
  }
}

/**
 * Recursively flattens composite or nested Anchor account structures.
 * Supports both standard flat accounts and Anchor v0.30 composite groups.
 */
function flattenAccounts(idlAccounts: any[], providedAccounts: any): any[] {
  const result: any[] = []
  for (const acc of idlAccounts) {
    if (acc.accounts) {
      const nestedProvided = providedAccounts[acc.name]
      if (!nestedProvided) {
        throw new Error(`Missing composite accounts group "${acc.name}"`)
      }
      result.push(...flattenAccounts(acc.accounts, nestedProvided))
    } else {
      const providedAcc = providedAccounts[acc.name]
      if (!providedAcc) {
        throw new Error(`Missing account "${acc.name}"`)
      }
      const accountAddress = typeof providedAcc === "object" && "address" in providedAcc
        ? providedAcc.address
        : (providedAcc as Address)

      result.push({
        address: accountAddress,
        role: acc.signer
          ? (acc.writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
          : (acc.writable ? AccountRole.WRITABLE : AccountRole.READONLY),
      })
    }
  }
  return result
}

export interface IdlInstructionOptions {
  args?: Record<string, any>
  accounts: Record<string, Address | TransactionSigner | any>
}

/**
 * Represents a dynamically resolved Anchor program client.
 * Provides dynamically generated Instruction creators under the `.instruction` property.
 */
export class IdlProgram {
  readonly address: Address
  readonly idl: any
  readonly instruction: Record<
    string,
    (options: IdlInstructionOptions) => Promise<Instruction>
  >
  readonly account: Record<
    string,
    {
      fetch: (address: Address) => Promise<any>
      fetchNullable: (address: Address) => Promise<any | null>
    }
  >

  constructor(address: Address, idl: any, rpc?: any) {
    this.address = address
    this.idl = idl

    this.instruction = new Proxy({}, {
      get: (target, propKey) => {
        if (typeof propKey !== "string") return undefined

        const ixDef = idl.instructions.find((ix: any) => ix.name === propKey)
        if (!ixDef) {
          throw new Error(`Instruction "${propKey}" not found in IDL for program ${address}`)
        }

        return async (options: IdlInstructionOptions) => {
          const { args = {}, accounts = {} } = options

          // 1. Build arguments encoder
          const idlTypes = idl.types || []
          const fields = (ixDef.args || []).map((arg: any) => [
            arg.name,
            getEncoderForIdlType(arg.type, idlTypes)
          ])
          const argsStructEncoder = getStructEncoder(fields)

          // 2. Encode arguments
          const encodedArgs = argsStructEncoder.encode(args)

          // 3. Resolve 8-byte instruction discriminator
          let discriminator: Uint8Array
          if (ixDef.discriminator) {
            discriminator = new Uint8Array(ixDef.discriminator)
          } else {
            discriminator = await getInstructionDiscriminator(propKey)
          }

          // 4. Combine discriminator and arguments
          const data = new Uint8Array(discriminator.length + encodedArgs.length)
          data.set(discriminator, 0)
          data.set(encodedArgs, discriminator.length)

          // 5. Recursively flatten and map account structures
          const mappedAccounts = flattenAccounts(ixDef.accounts || [], accounts)

          // 6. Return native @solana/kit Instruction
          return {
            programAddress: address,
            accounts: mappedAccounts,
            data,
          } as Instruction
        }
      }
    })

    this.account = new Proxy({}, {
      get: (target, propKey) => {
        if (typeof propKey !== "string") return undefined

        const accountDef = idl.accounts?.find(
          (acc: any) => acc.name.toLowerCase() === propKey.toLowerCase()
        )
        if (!accountDef) {
          throw new Error(`Account definition for "${propKey}" not found in IDL`)
        }

        return {
          fetch: async (accountAddress: Address) => {
            if (!rpc) {
              throw new Error(
                `RPC client is not initialized on this IdlProgram. ` +
                `Load the program using client.loadProgram() to enable fetching.`
              )
            }

            const accountInfo = await rpc.getAccountInfo(accountAddress, { encoding: "base64" }).send()
            if (!accountInfo.value) {
              throw new Error(`Account ${accountAddress} not found`)
            }

            const { getBase64Encoder } = await import("@solana/kit")
            const rawBytes = getBase64Encoder().encode(accountInfo.value.data[0])

            const discriminatorSize = 8
            if (rawBytes.length < discriminatorSize) {
              throw new Error("Account data is too small to contain a discriminator")
            }

            // Verify account discriminator to prevent type confusion
            let expectedDiscriminator: Uint8Array
            if (accountDef.discriminator) {
              expectedDiscriminator = new Uint8Array(accountDef.discriminator)
            } else {
              expectedDiscriminator = await getAccountDiscriminator(accountDef.name)
            }

            const actualDiscriminator = rawBytes.subarray(0, discriminatorSize)
            let match = true
            for (let i = 0; i < discriminatorSize; i++) {
              if (actualDiscriminator[i] !== expectedDiscriminator[i]) {
                match = false
                break
              }
            }
            if (!match) {
              throw new Error(`Discriminator mismatch. The account fetched is not of type "${accountDef.name}"`)
            }

            const dataBytes = rawBytes.subarray(discriminatorSize)

            // Construct struct decoder dynamically based on IDL
            const idlTypes = idl.types || []
            const fields = (accountDef.type.fields || []).map((f: any) => [
              f.name,
              getDecoderForIdlType(f.type, idlTypes)
            ])
            const structDecoder = getStructDecoder(fields)

            return structDecoder.decode(dataBytes)
          },
          fetchNullable: async (accountAddress: Address) => {
            try {
              const acc = this.account[propKey]
              if (acc) {
                return await acc.fetch(accountAddress)
              }
              return null
            } catch (e: any) {
              if (e.message.includes("not found")) return null
              throw e
            }
          }
        }
      }
    })
  }
}
