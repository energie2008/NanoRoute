const { SocksClient } = require('socks');
const tls = require('tls');

async function test() {
  try {
    console.log('1. 建立SOCKS连接到 api.ipify.org:443...');
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
    
    let data = '';
    tlsSocket.on('data', (chunk) => {
      data += chunk.toString();
    });
    tlsSocket.on('end', () => {
      console.log('📥 响应成功，出口IP:', data.split('\r\n\r\n')[1]);
      tlsSocket.destroy();
      console.log('\n🎉 SOCKS代理TCP+TLS工作完全正常！');
    });
    tlsSocket.on('error', (e) => console.log('TLS错误:', e.message));
    
  } catch(e) {
    console.error('❌ 失败:', e.message);
    console.error(e);
  }
}

test();
