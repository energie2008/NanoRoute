import { SocksProxyAgent } from 'socks-proxy-agent';
import { Agent, fetch } from 'undici';

async function test() {
  try {
    const proxyUrl = 'socks5://hmfpcsfd:lfr0o0ar4u2f@163.123.203.113:8216';
    console.log('🔌 创建SocksProxyAgent...');
    const socksAgent = new SocksProxyAgent(proxyUrl);
    
    console.log('🌐 创建undici Agent...');
    const dispatcher = new Agent({
      connect: (options, callback) => {
        let port = parseInt(options.port, 10);
        if (!port) {
          port = options.protocol === 'https:' ? 443 : 80;
        }
        console.log(`🔗 连接到 ${options.hostname}:${port} (${options.protocol})`);
        socksAgent.createConnection({ ...options, port }, callback);
      }
    });
    
    console.log('📤 发起HTTPS请求...');
    const res = await fetch('https://api.ipify.org', { dispatcher, signal: AbortSignal.timeout(20000) });
    const ip = await res.text();
    console.log('✅ 请求成功！代理出口IP:', ip);
    
    console.log('\n🎉 SOCKS代理 + undici 完美工作！HTTP和SOCKS5都支持了！');
  } catch(e) {
    console.error('❌ 失败:', e.message);
    console.error(e.stack);
  }
}

test();
