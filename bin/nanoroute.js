#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const commands = {
  init() {
    console.log('🚀 Initializing NanoRoute...\n');
    
    const configPath = './config.yml';
    const examplePath = join(rootDir, 'config.example.yml');
    
    if (existsSync(configPath)) {
      console.log('⚠️  config.yml already exists');
      console.log('   Use a different directory or backup your existing config\n');
      return;
    }
    
    try {
      copyFileSync(examplePath, configPath);
      console.log('✓ Created config.yml from example');
      console.log('\n📝 Next steps:');
      console.log('   1. Edit config.yml with your API keys');
      console.log('   2. Run: nanoroute start');
      console.log('   3. Open: http://localhost:20128\n');
    } catch (err) {
      console.error('✗ Failed to create config.yml:', err.message);
      process.exit(1);
    }
  },
  
  start() {
    console.log('🚀 Starting NanoRoute...\n');
    
    if (!existsSync('./config.yml')) {
      console.error('✗ config.yml not found');
      console.error('   Run: nanoroute init\n');
      process.exit(1);
    }
    
    const serverPath = join(rootDir, 'server.js');
    const child = spawn('node', [serverPath], {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    child.on('error', (err) => {
      console.error('✗ Failed to start server:', err.message);
      process.exit(1);
    });
    
    child.on('exit', (code) => {
      process.exit(code || 0);
    });
  },
  
  check() {
    console.log('🔍 Checking NanoRoute health...\n');
    
    fetch('http://localhost:20128/api/health')
      .then(res => res.json())
      .then(data => {
        console.log('✓ Server is running');
        console.log(`  Status: ${data.status}`);
        console.log(`  Version: ${data.version}`);
        console.log(`  Memory: ${data.memory?.rss}MB RSS\n`);
      })
      .catch(() => {
        console.error('✗ Server is not running');
        console.error('   Run: nanoroute start\n');
        process.exit(1);
      });
  },
  
  update() {
    console.log('🔄 Checking for updates...\n');
    console.log('⚠️  Update feature coming soon');
    console.log('   For now, manually update via:');
    console.log('   npm update -g nanoroute\n');
  },
  
  help() {
    console.log(`
NanoRoute CLI v0.1.0
Lightweight AI Gateway

USAGE:
  nanoroute <command>

COMMANDS:
  init      Create config.yml from example
  start     Start the gateway server
  check     Check server health
  update    Update to latest version
  help      Show this help message

EXAMPLES:
  nanoroute init          # Initialize config
  nanoroute start         # Start server
  nanoroute check         # Health check

For more info: https://github.com/nanoroute/nanoroute
    `);
  }
};

// Parse command
const cmd = process.argv[2] || 'help';

if (commands[cmd]) {
  commands[cmd]();
} else {
  console.error(`Unknown command: ${cmd}\n`);
  commands.help();
  process.exit(1);
}
