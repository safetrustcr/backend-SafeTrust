#!/usr/bin/env node

/**
 * Simple syntax check for all event trigger files
 */

const fs = require('fs');
const path = require('path');

const filesToCheck = [
  'utils/database.js',
  'utils/logger.js',
  'services/notification.service.js',
  'services/escrow-state.service.js',
  'services/blockchain.service.js',
  'events/escrow-created.js',
  'events/user-funded.js',
  'events/all-funded.js',
  'events/condition-verified.js',
  'events/all-conditions-met.js',
  'events/fund-released.js',
  'events/refund-requested.js',
];

let allPassed = true;

console.log('🔍 Checking syntax of event trigger files...\n');

filesToCheck.forEach((file) => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${file} - File not found`);
    allPassed = false;
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Basic syntax check - try to parse as JavaScript
    new Function(content);
    console.log(`✅ ${file} - Syntax OK`);
  } catch (error) {
    console.log(`❌ ${file} - Syntax Error: ${error.message.split('\n')[0]}`);
    allPassed = false;
  }
});

console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ All files passed syntax check!');
  process.exit(0);
} else {
  console.log('❌ Some files have syntax errors');
  process.exit(1);
}
