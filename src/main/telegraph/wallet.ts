/**
 * Burner-wallet management for Telegraph x402 payments.
 * Keys are stored through the OS keychain-encrypted settings store, never in
 * the renderer, and never in session files.
 */
import { createWalletClient, createPublicClient, http, formatUnits, parseAbi, type PublicClient, type HttpTransport, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, base } from 'viem/chains'
import { randomBytes } from 'node:crypto'
import type { TelegraphNetworkConfig } from '@shared/types'

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)',
])

export interface WalletInfo {
  address: string
  privateKey: string
}

export function createBurnerWallet(): WalletInfo {
  const pk = `0x${randomBytes(32).toString('hex')}`
  const account = privateKeyToAccount(pk as `0x${string}`)
  return { address: account.address, privateKey: pk }
}

export function importWallet(privateKey: string): WalletInfo {
  const pk = privateKey.trim().toLowerCase().startsWith('0x') ? privateKey.trim() : `0x${privateKey.trim()}`
  const account = privateKeyToAccount(pk as `0x${string}`)
  return { address: account.address, privateKey: pk }
}

export function walletAddress(privateKey: string): string | undefined {
  try {
    return privateKeyToAccount(privateKey.trim() as `0x${string}`).address
  } catch {
    return undefined
  }
}

export function publicClientFor(network: TelegraphNetworkConfig): PublicClient<HttpTransport, Chain> {
  return createPublicClient({
    transport: http(network.rpcUrl),
    chain: network.chainId === 8453 ? base : baseSepolia,
  }) as PublicClient<HttpTransport, Chain>
}

export async function usdcBalance(privateKey: string, network: TelegraphNetworkConfig): Promise<string> {
  const address = walletAddress(privateKey)
  if (!address) return '0'
  try {
    const client = publicClientFor(network)
    const balance = await client.readContract({
      address: network.usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })
    return formatUnits(balance, 6)
  } catch (err) {
    console.warn('[halis] usdc balance read failed:', err)
    return '0'
  }
}

export async function ethBalanceForGas(privateKey: string, network: TelegraphNetworkConfig): Promise<string> {
  const address = walletAddress(privateKey)
  if (!address) return '0'
  try {
    const client = publicClientFor(network)
    const balance = await client.getBalance({ address: address as `0x${string}` })
    return formatUnits(balance, 18)
  } catch {
    return '0'
  }
}

export { createWalletClient }
