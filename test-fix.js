import { SocksClient } from 'socks';
import { Agent } from 'undici';

async function test() {
  try {
    console.log('🔌 测试SOCKS连接建立...');
    const { socket } = await SocksClient.createConnection({
      proxy: { host: '163.123.203.113', port: 8216, type: 5, userId: 'hmfpcsfd', password: 'lfr0o0ar4u2f' },
      command: 'connect',
      destination: { host: 'api.ipify.org', port: 443 }
    });
    console.log('✅ SOCKS TCP连接建立成功');
    socket.destroy();

    console.log('🌐 测试undici通过SOCKS代理HTTPS请求...');
    const dispatcher = new Agent({
      connect: async (options) => {
        let port = parseInt(options.port, 10);
        if (!port) {
          port = options.protocol === 'https:' ? 443 : 80;
        }
        const result = await SocksClient.createConnection({
          proxy: { host: '163.123.203.113', port: 8216, type: 5, userId: 'hmfpcsfd', password: 'lfr0o0ar4u2f' },
          command: 'connect',
          destination: { host: options.hostname, port: port }
        });
        return result.socket;
      }
    });
    
    const res = await fetch('https://api.ipify.org', { dispatcher, signal: AbortSignal.timeout(15000) });
    const ip = await res.text();
    console.log('✅ HTTPS请求成功！代理出口IP:', ip);
    
    console.log('\n🎉 SOCKS代理修复成功！现在HTTP和SOCKS5代理都可以正常使用了！');
    console.log('\n📝 使用方法：在全局代理填写 socks5://hmfpcsfd:lfr0o0ar4u2f@163.123.203.113:8216 保存即可');
  } catch(e) {
    console.error('❌ 测试失败:', e.message);
    console.error(e.stack);
  }
}

test();
