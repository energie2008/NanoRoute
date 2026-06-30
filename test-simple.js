const { SocksClient } = require('socks');
const http = require('http');
const tls = require('tls');
const { Agent } = require('undici');

async function test() {
  try {
    console.log('1. 建立SOCKS连接到 api.ipify.org:80 (HTTP)...');
    const { socket } = await SocksClient.createConnection({
      proxy: { host: '163.123.203.113', port: 8216, type: 5, userId: 'hmfpcsfd', password: 'lfr0o0ar4u2f' },
      command: 'connect',
      destination: { host: 'api.ipify.org', port: 80 }
    });
    console.log('✅ SOCKS TCP连接建立成功');
    
    // 手动发HTTP请求测试socket是否可用
    socket.write('GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
    socket.on('data', (data) => {
      console.log('📥 收到HTTP响应:', data.toString());
      socket.destroy();
      
      // 测试HTTPS
      testHttps();
    });
    socket.on('error', (e) => console.log('Socket错误:', e.message));
    
  } catch(e) {
    console.error('❌ 失败:', e.message);
  }
}

async function testHttps() {
  try {
    console.log('\n2. 建立SOCKS连接到 api.ipify.org:443 (HTTPS)...');
    const { socket } = await SocksClient.createConnection({
      proxy: { host: '163.123.203.113', port: 8216, type: 5, userId: 'hmfpcsfd', password: 'lfr0o0ar4u2f' },
      command: 'connect',
      destination: { host: 'api.ipify.org', port: 443 }
    });
    console.log('✅ SOCKS TCP连接成功，开始TLS握手...');
    
    const tlsSocket = tls.connect({
      socket: socket,
      servername: 'api.ipify.org',
      ALPNProtocols: ['http/1.1']
    }, () => {
      console.log('✅ TLS握手成功');
      tlsSocket.write('GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
    });
    
    tlsSocket.on('data', (data) => {
      console.log('📥 收到HTTPS响应:', data.toString().substring(0, 200));
      tlsSocket.destroy();
      console.log('\n🎉 SOCKS代理完全正常！TCP/TLS都工作正常！');
    });
    tlsSocket.on('error', (e) => console.log('TLS错误:', e.message));
    
  } catch(e) {
    console.error('❌ HTTPS测试失败:', e.message);
  }
}

test();
