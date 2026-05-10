import { describe, expect, it } from "vitest";
import { connect } from "../../src/client.js";
import { InvalidClusterError } from "../../src/errors.js";
import { generateKey } from "../../src/keypair.js";
import { setupTest, isValidatorRunning } from "./setup.js";
import { toLamport, toSol } from "../../src/utils.js";


describe("connect() integration", () => {
    it("connects to localnet and fetches blockhash", async() => {
        if (!isValidatorRunning) return

        const client = connect("localnet");
        const bh = await client.recentBlockhash();

        expect(typeof bh.blockhash).toBe("string");
        expect(bh.blockhash.length).toBeGreaterThan(30);

        expect(typeof bh.lastValidBlockHeight).toBe("bigint");
        expect(bh.lastValidBlockHeight).toBeGreaterThan(0n);
    })

    it("shows InvalidClusterError for bad cluster", () => {
        expect(() => connect("wrongcluster")).toThrow(InvalidClusterError)
    })
})

describe("client.balance()", () => {
    it("returns 0 for fresh account", async() => {
        if (!isValidatorRunning) return

        const client = connect("localnet");
        const fresh = await generateKey();

        const balance = await client.balance(fresh.address);

        expect(balance).toBe(0n);
    })

    it("returns correct balance after airdrop", async() => {
        const {client, payer} = await setupTest();

        const balance = await client.balance(payer.address);

        expect(toSol(balance)).toBe(2)
    })
})

describe("client.airdrop()", () => {
    if (!isValidatorRunning) return
    it("funds the account with request amount", async() => {
        const client = connect("localnet");
        const wallet = await generateKey();

        await client.airdrop(wallet.address, toLamport(1));

        const balance = await client.balance(wallet.address);

        expect(balance).toBe(toLamport(1));
    })

})

describe("client.rentFor()", () => {

    it("returns a positive lamport amount", async () => {

    const client = connect("localnet")

    // Rent for a token account (165 bytes)
    const rent = await client.rentFor(165)

    expect(rent).toBeGreaterThan(0n)
    // Should be roughly 0.002 SOL — sanity check
    expect(rent).toBeGreaterThan(1_000_000n)
    expect(rent).toBeLessThan(10_000_000n)
  })

  it("larger accounts cost more rent", async () => {

    const client = connect("localnet")

    const smallRent = await client.rentFor(82)    // mint size
    const largeRent = await client.rentFor(165)   // token account size

    expect(largeRent).toBeGreaterThan(smallRent)
  })

})