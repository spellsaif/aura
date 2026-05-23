import { describe, it, expect } from "vitest"
import { getEncoderForIdlType, getDecoderForIdlType, getInstructionDiscriminator, getAccountDiscriminator, IdlProgram } from "../src/idl.js"
import { getAddressEncoder, getBase64Decoder, AccountRole } from "@solana/kit"

describe("IDL Discriminator Calculation", () => {
  it("calculates the correct 8-byte instruction discriminator via SHA-256", async () => {
    // Formula: global:initializeUser -> SHA-256 -> first 8 bytes
    const discriminator = await getInstructionDiscriminator("initializeUser")
    
    expect(discriminator).toBeInstanceOf(Uint8Array)
    expect(discriminator.length).toBe(8)
    
    // Check known values if possible (manual hex comparisons)
    // "global:initialize" discriminator is [175, 175, 109, 31, 13, 152, 155, 237]
    const initDiscriminator = await getInstructionDiscriminator("initialize")
    expect(Array.from(initDiscriminator)).toEqual([175, 175, 109, 31, 13, 152, 155, 237])
  })
})

describe("IDL Type to @solana/kit Codec Mapping", () => {
  it("maps basic numeric primitive types correctly", () => {
    const u8Encoder = getEncoderForIdlType("u8")
    const u64Encoder = getEncoderForIdlType("u64")
    
    expect(u8Encoder.encode(42)).toEqual(new Uint8Array([42]))
    expect(u64Encoder.encode(100n)).toEqual(new Uint8Array([100, 0, 0, 0, 0, 0, 0, 0]))
  })

  it("maps bool primitive types correctly", () => {
    const boolEncoder = getEncoderForIdlType("bool")
    expect(boolEncoder.encode(true)).toEqual(new Uint8Array([1]))
    expect(boolEncoder.encode(false)).toEqual(new Uint8Array([0]))
  })

  it("maps publicKey types correctly", () => {
    const keyEncoder = getEncoderForIdlType("publicKey")
    const testAddress = "So11111111111111111111111111111111111111112"
    const expectedBytes = getAddressEncoder().encode(testAddress)
    
    expect(keyEncoder.encode(testAddress)).toEqual(expectedBytes)
  })

  it("maps Borsh string types (with u32 size prefix) correctly", () => {
    const stringEncoder = getEncoderForIdlType("string")
    const bytes = stringEncoder.encode("hello")
    
    // Borsh string: 5 as u32 little endian [5, 0, 0, 0] followed by "hello" UTF-8 bytes [104, 101, 108, 108, 111]
    expect(Array.from(bytes)).toEqual([5, 0, 0, 0, 104, 101, 108, 108, 111])
  })

  it("maps options recursively", () => {
    const optionEncoder = getEncoderForIdlType({ option: "u8" })
    
    // None -> [0]
    expect(Array.from(optionEncoder.encode(null))).toEqual([0])
    expect(Array.from(optionEncoder.encode(undefined))).toEqual([0])
    // Some(42) -> [1, 42]
    expect(Array.from(optionEncoder.encode(42))).toEqual([1, 42])
  })

  it("maps vectors recursively", () => {
    const vecEncoder = getEncoderForIdlType({ vec: "u8" })
    
    // Vec of [10, 20] -> 2 as u32 prefix [2, 0, 0, 0] followed by [10, 20]
    expect(Array.from(vecEncoder.encode([10, 20]))).toEqual([2, 0, 0, 0, 10, 20])
  })

  it("maps custom defined structs recursively", () => {
    const idlTypes = [
      {
        name: "CustomStruct",
        type: {
          kind: "struct",
          fields: [
            { name: "id", type: "u8" },
            { name: "isActive", type: "bool" }
          ]
        }
      }
    ]
    
    const structEncoder = getEncoderForIdlType({ defined: "CustomStruct" }, idlTypes)
    const bytes = structEncoder.encode({ id: 5, isActive: true })
    
    expect(Array.from(bytes)).toEqual([5, 1])
  })

  it("gracefully falls back to raw bytes for unsupported types", () => {
    const fallbackEncoder = getEncoderForIdlType({ kind: "unknown_complex_type" })
    
    const rawBytes = new Uint8Array([1, 2, 3, 4])
    expect(fallbackEncoder.encode(rawBytes)).toBe(rawBytes)
    
    expect(() => fallbackEncoder.encode({ invalid: true })).toThrow(/Unsupported IDL type/)
  })
})

describe("IdlProgram Dynamic Client Proxy", () => {
  const sampleIdl = {
    address: "MyProgramAddress11111111111111111111111111",
    metadata: { name: "test_program" },
    instructions: [
      {
        name: "testInstruction",
        accounts: [
          { name: "signerAccount", signer: true, writable: false },
          { name: "writableAccount", signer: false, writable: true },
          { name: "writableSigner", signer: true, writable: true }
        ],
        args: [
          { name: "count", type: "u8" },
          { name: "label", type: "string" }
        ]
      },
      {
        name: "compositeInstruction",
        accounts: [
          {
            name: "group",
            accounts: [
              { name: "sub1", signer: true, writable: false },
              { name: "sub2", signer: false, writable: true }
            ]
          },
          { name: "otherAccount", signer: false, writable: false }
        ],
        args: []
      }
    ]
  }

  const programAddress = "MyProgramAddress11111111111111111111111111"

  it("instantiates instructions dynamically via JS Proxy", async () => {
    const program = new IdlProgram(programAddress, sampleIdl)
    
    const testSigner = { address: "SignerAddress1111111111111111111111111111" }
    
    const ix = await program.instruction.testInstruction({
      args: { count: 3, label: "abc" },
      accounts: {
        signerAccount: testSigner,
        writableAccount: "WritableAddress111111111111111111111111111",
        writableSigner: testSigner
      }
    })
    
    // Check program address
    expect(ix.programAddress).toBe(programAddress)
    
    // Check accounts structure mapping and role mapping
    expect(ix.accounts).toHaveLength(3)
    expect(ix.accounts[0]).toEqual({
      address: "SignerAddress1111111111111111111111111111",
      role: AccountRole.READONLY_SIGNER
    })
    expect(ix.accounts[1]).toEqual({
      address: "WritableAddress111111111111111111111111111",
      role: AccountRole.WRITABLE
    })
    expect(ix.accounts[2]).toEqual({
      address: "SignerAddress1111111111111111111111111111",
      role: AccountRole.WRITABLE_SIGNER
    })

    // Check payload data (8-byte discriminator + serialized args)
    const expectedDiscriminator = await getInstructionDiscriminator("testInstruction")
    expect(ix.data.subarray(0, 8)).toEqual(expectedDiscriminator)
    
    // Argument 1 (u8 = 3) at index 8
    expect(ix.data[8]).toBe(3)
    
    // Argument 2 (string "abc" -> Borsh: 3 as u32 prefix [3,0,0,0] + "abc" [97,98,99])
    expect(Array.from(ix.data.subarray(9))).toEqual([3, 0, 0, 0, 97, 98, 99])
  })

  it("recursively flattens composite accounts", async () => {
    const program = new IdlProgram(programAddress, sampleIdl)
    
    const ix = await program.instruction.compositeInstruction({
      accounts: {
        group: {
          sub1: "Sub1Address111111111111111111111111111111",
          sub2: "Sub2Address111111111111111111111111111111"
        },
        otherAccount: "OtherAddress11111111111111111111111111111"
      }
    })
    
    expect(ix.accounts).toHaveLength(3)
    expect(ix.accounts[0]).toEqual({
      address: "Sub1Address111111111111111111111111111111",
      role: AccountRole.READONLY_SIGNER
    })
    expect(ix.accounts[1]).toEqual({
      address: "Sub2Address111111111111111111111111111111",
      role: AccountRole.WRITABLE
    })
    expect(ix.accounts[2]).toEqual({
      address: "OtherAddress11111111111111111111111111111",
      role: AccountRole.READONLY
    })
  })

  it("throws error for missing accounts or instructions", async () => {
    const program = new IdlProgram(programAddress, sampleIdl)
    
    expect(() => (program.instruction as any).nonExistentInstruction).toThrow(/Instruction "nonExistentInstruction" not found/)
    
    await expect(program.instruction.testInstruction({
      args: { count: 3, label: "abc" },
      accounts: {
        signerAccount: "SignerAddress1111111111111111111111111111",
        // missing writableAccount and writableSigner
      }
    })).rejects.toThrow(/Missing account "writableAccount"/)
  })
})

describe("IdlProgram Dynamic Account Fetching & Decoding", () => {
  const accountIdl = {
    address: "MyProgramAddress11111111111111111111111111",
    metadata: { name: "account_program" },
    accounts: [
      {
        name: "UserProfile",
        type: {
          kind: "struct",
          fields: [
            { name: "username", type: "string" },
            { name: "age", type: "u32" }
          ]
        }
      }
    ]
  }

  const programAddress = "MyProgramAddress11111111111111111111111111"

  it("calculates the correct 8-byte account discriminator", async () => {
    const discriminator = await getAccountDiscriminator("UserProfile")
    expect(discriminator).toBeInstanceOf(Uint8Array)
    expect(discriminator.length).toBe(8)
  })

  it("fetches, verifies discriminator, and decodes account data successfully", async () => {
    const expectedDiscriminator = await getAccountDiscriminator("UserProfile")
    
    // Serialized { username: "saif", age: 26 }
    // Borsh string: 4 as u32 prefix [4,0,0,0] + "saif" [115, 97, 105, 102]
    // Borsh u32: 26 as u32 little endian [26, 0, 0, 0]
    const structBody = new Uint8Array([4, 0, 0, 0, 115, 97, 105, 102, 26, 0, 0, 0])
    
    // Combine expected discriminator + body
    const fullPayload = new Uint8Array(expectedDiscriminator.length + structBody.length)
    fullPayload.set(expectedDiscriminator, 0)
    fullPayload.set(structBody, expectedDiscriminator.length)
    
    // Convert to base64 for RPC response mock
    const base64Data = getBase64Decoder().decode(fullPayload)

    // Mock RPC client
    const mockRpc = {
      getAccountInfo: (address: string, config: any) => {
        return {
          send: async () => {
            return {
              value: {
                data: [base64Data, "base64"]
              }
            }
          }
        }
      }
    }

    const program = new IdlProgram(programAddress, accountIdl, mockRpc)
    const profile = await program.account.userProfile.fetch("MockAccountAddress111111111111111111111111")
    
    expect(profile).toBeDefined()
    expect(profile.username).toBe("saif")
    expect(profile.age).toBe(26)
  })

  it("throws detailed error when account discriminator mismatches", async () => {
    // Return a completely invalid discriminator
    const invalidDiscriminator = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])
    const structBody = new Uint8Array([4, 0, 0, 0, 115, 97, 105, 102, 26, 0, 0, 0])
    
    const fullPayload = new Uint8Array(8 + structBody.length)
    fullPayload.set(invalidDiscriminator, 0)
    fullPayload.set(structBody, 8)
    
    const base64Data = getBase64Decoder().decode(fullPayload)

    const mockRpc = {
      getAccountInfo: (address: string, config: any) => {
        return {
          send: async () => {
            return {
              value: {
                data: [base64Data, "base64"]
              }
            }
          }
        }
      }
    }

    const program = new IdlProgram(programAddress, accountIdl, mockRpc)
    
    await expect(
      program.account.userProfile.fetch("MockAccountAddress111111111111111111111111")
    ).rejects.toThrow(/Discriminator mismatch/)
  })
})
