import { KeyPairSigner } from "@solana/kit";
import {AuraClient, connect} from "../../src/client.js";
import {generateKey} from "../../src/keypair.js"
import { toLamports } from "../../src/utils.js";

export async function setupTest(): Promise<{
    client: AuraClient,
    payer: KeyPairSigner
}> {
    const client = connect("localnet");

    const payer = await generateKey();

    await client.airdrop(payer.address, toLamports(2));

    return {client, payer};
}

export async function isValidatorRunning(): Promise<boolean> {
  try {
    const client = connect("localnet")
    await client.rpc.getHealth().send()
    return true
  } catch {
    return false
  }
}