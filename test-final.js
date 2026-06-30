import { SocksClient } from 'socks';
import { Agent, fetch } from 'undici';

async function test() {
  try {
    const proxyConfig = {
      host: '163.123.203.113',
      port: 8216,
      type: 5,
      userId: 'hmfpcsfd',
      password: 'lfr0o0ar4u2f'
    };
    
    console.log('🌐 创建undici SOCKS Agent (allowH2: false)...');
    const dispatcher = new Agent({
      allowH2: false,
      connect: async (options) => {
        let port = parseInt(options.port, 10);
        if (!port) {
          port = options.protocol === 'https:' ? 443 : 80;
        }
        console.log(`🔗 连接 ${options.hostname}:${port}`);
        
        const { socket } = await SocksClient.createConnection({
          proxy: proxyConfig,
          command: 'connect',
          destination: {
            host: options.hostname,
            port: port
          },
          set_tcp_nodelay: true
        });
        
        socket.setKeepAlive(true, 60000);
        return socket;
      }
    });
    
    console.log('📤 发起请求到 https://api.ipify.org ...');
    const res = await fetch('https://api.ipify.org', { dispatcher, signal: AbortSignal.timeout(30000) });
    const ip = await res.text();
    console.log('✅ 请求成功！');
    console.log('🌍 代理出口IP:', ip);
    console.log('\n🎉 完美！HTTP和SOCKS5代理都正常支持了！');
  } catch(e) {
    console.error('❌ 失败:', e.message);
    console.error(e.cause || '');
  }
}

test();
