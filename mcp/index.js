export class MCPServer {
  constructor(router) {
    this.router = router;
    this.connections = new Set();
    this._pingInterval = null;
    this._startPing();
  }

  _startPing() {
    if (this._pingInterval) return;
    this._pingInterval = setInterval(() => {
      for (const res of this.connections) {
        try {
          if (!res.writableEnded) {
            res.write(': ping\n\n');
          }
        } catch {}
      }
    }, 30000);
  }

  handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const sessionId = Math.random().toString(36).slice(2, 15);
    this.connections.add(res);

    res.write(`event: endpoint\ndata: /mcp/message?sessionId=${sessionId}\n\n`);

    this._sendMessage(res, {
      jsonrpc: '2.0',
      method: 'server/initialized',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'nanoroute-mcp',
          version: '0.2.0'
        }
      },
      id: null
    });

    req.on('close', () => {
      this.connections.delete(res);
    });

    return sessionId;
  }

  async handleMessage(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const message = JSON.parse(body);
        const result = await this._handleRPC(message);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
      }
    });
  }

  async _handleRPC(message) {
    const { method, params, id } = message;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'nanoroute-mcp', version: '0.2.0' }
          },
          id
        };

      case 'notifications/initialized':
        return { jsonrpc: '2.0', result: null, id };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'chat_completion',
                description: 'Send a chat completion request through NanoRoute AI gateway',
                inputSchema: {
                  type: 'object',
                  properties: {
                    model: { type: 'string', description: 'Model name (e.g., gpt-4o-mini, gemini-2.5-flash)' },
                    messages: {
                      type: 'array',
                      description: 'Array of chat messages',
                      items: {
                        type: 'object',
                        properties: {
                          role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                          content: { type: 'string' }
                        }
                      }
                    },
                    stream: { type: 'boolean', description: 'Stream response', default: false }
                  },
                  required: ['model', 'messages']
                }
              }
            ]
          },
          id
        };

      case 'tools/call':
        try {
          const result = await this._callTool(params.name, params.arguments || {});
          return { jsonrpc: '2.0', result, id };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            error: { code: -32603, message: err.message },
            id
          };
        }

      case 'ping':
        return { jsonrpc: '2.0', result: {}, id };

      default:
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
          id
        };
    }
  }

  async _callTool(name, args) {
    if (name !== 'chat_completion') {
      throw new Error(`Unknown tool: ${name}`);
    }

    const { model, messages, stream = false } = args;
    if (!model || !messages) {
      throw new Error('model and messages are required');
    }

    return new Promise((resolve, reject) => {
      let fullContent = '';
      let error = null;

      const mockRes = {
        writeHead: () => {},
        setHeader: () => {},
        write: (chunk) => {
          try {
            const text = chunk.toString();
            if (text.startsWith('data: ')) {
              const jsonStr = text.slice(6).trim();
              if (jsonStr === '[DONE]') return;
              const data = JSON.parse(jsonStr);
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
            }
          } catch {}
        },
        end: () => {
          if (error) {
            reject(new Error(error));
          } else {
            resolve({
              content: [
                { type: 'text', text: fullContent || 'No response' }
              ]
            });
          }
        },
        status: () => mockRes,
        json: (data) => {
          if (data.error) {
            error = data.error.message;
          } else if (data.choices?.[0]?.message?.content) {
            fullContent = data.choices[0].message.content;
          }
          mockRes.end();
        },
        send: (data) => {
          if (typeof data === 'string') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) error = parsed.error.message;
            } catch {}
          }
          mockRes.end();
        }
      };

      const parsedRequest = { model, messages, stream: true, options: {} };
      this.router.handleRequest(
        { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
        mockRes,
        parsedRequest
      ).catch(reject);
    });
  }

  _sendMessage(res, message) {
    try {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(message)}\n\n`);
      }
    } catch {}
  }

  shutdown() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    for (const res of this.connections) {
      try { res.end(); } catch {}
    }
    this.connections.clear();
  }
}
