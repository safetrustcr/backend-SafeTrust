const { ethers } = require('ethers');
const { logger } = require('./logger');

class BlockchainService {
  constructor() {
    this.providers = {
      polygon: new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'),
      ethereum: new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL),
    };
    this.minConfirmations = parseInt(process.env.MIN_CONFIRMATIONS || '3');
  }

  // Retry Logic
  async _withRetry(fn, retries = 3, delay = 1000) {
    try {
      return await fn();
    } catch (error) {
      if (retries === 0) throw error;
      await new Promise(res => setTimeout(res, delay));
      return this._withRetry(fn, retries - 1, delay * 2);
    }
  }

  verifySignature(message, signature, expectedAddress) {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      logger.error('Signature verification failed:', error);
      return false;
    }
  }

  async getTransaction(txHash, network = 'polygon') {
    return this._withRetry(async () => {
      try {
        const provider = this.providers[network.toLowerCase()] || this.providers['polygon'];
        const tx = await provider.getTransaction(txHash);
        
        if (!tx) return { exists: false };

        const receipt = await provider.getTransactionReceipt(txHash);
        const currentBlock = await provider.getBlockNumber();
        
        return {
          exists: true,
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: ethers.formatEther(tx.value),
          blockNumber: receipt?.blockNumber || null,
          confirmations: receipt ? currentBlock - receipt.blockNumber : 0,
          status: receipt?.status === 1 ? 'success' : 'failed',
          gasUsed: receipt?.gasUsed?.toString() || null,
        };
      } catch (error) {
        logger.error(`Failed to get transaction ${txHash}:`, error);
        throw new Error('Blockchain query failed');
      }
    });
  }

  async verifyTransactionConfirmed(txHash, network = 'polygon') {
    const tx = await this.getTransaction(txHash, network);
    
    if (!tx.exists) return { verified: false, reason: 'Transaction not found' };
    if (tx.status === 'failed') return { verified: false, reason: 'Transaction failed on blockchain' };
    if (tx.confirmations < this.minConfirmations) {
      return { 
        verified: false, 
        reason: `Insufficient confirmations (${tx.confirmations}/${this.minConfirmations})` 
      };
    }

    return { verified: true, transaction: tx };
  }

  async estimateGas(contractAddress, abi, method, params, network = 'polygon') {
    try {
      const provider = this.providers[network.toLowerCase()] || this.providers['polygon'];
      // Supports both full ABI or minimal array
      const contract = new ethers.Contract(contractAddress, abi, provider);
      
      const gasEstimate = await this._withRetry(() => contract[method].estimateGas(...params));
      const feeData = await provider.getFeeData();
      
      return {
        gasLimit: (gasEstimate * 120n / 100n).toString(), // +20% buffer
        gasPrice: feeData.gasPrice?.toString() || '0',
        estimatedCost: ethers.formatEther(gasEstimate * (feeData.gasPrice || 0n))
      };
    } catch (error) {
      logger.error('Gas estimation failed:', error);
      return { gasLimit: '500000', gasPrice: '0', estimatedCost: '0' };
    }
  }

  async getSigner(network = 'polygon') {
      const provider = this.providers[network.toLowerCase()] || this.providers['polygon'];
      return new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
  }
}

module.exports = new BlockchainService();