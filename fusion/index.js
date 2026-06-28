const FUSION_JUDGE_PROMPT = `以下是多个AI对同一问题的回答，请分析所有回答，综合出一个最优答案。
标出共识点和矛盾点，如有盲点补充说明。
最终输出一个完整、准确、全面的回答。直接给出答案，不需要重复分析过程。`;

export class FusionHandler {
  constructor(router) {
    this.router = router;
  }

  async handleFusion(req, res, parsedRequest, combo) {
    const { panel, judge, min_panel = 2, quorum_grace_ms = 8000, hard_timeout_ms = 90000 } = combo;
    const { model, messages, stream, options } = parsedRequest;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), hard_timeout_ms);

    const answers = [];
    const errors = [];
    let quorumTimer = null;
    let quorumReached = false;

    const panelRequests = panel.map(async (panelModel) => {
      try {
        const result = await this._callSingleModel(panelModel, messages, abortController.signal);
        if (result && result.content) {
          answers.push({ model: panelModel, content: result.content });
          this._checkQuorum();
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          errors.push({ model: panelModel, error: err.message });
        }
      }
    });

    function _checkQuorum() {
      if (quorumReached) return;
      if (answers.length >= min_panel) {
        quorumReached = true;
        quorumTimer = setTimeout(() => {
          abortController.abort();
        }, quorum_grace_ms);
      }
    }
    this._checkQuorum = _checkQuorum.bind(this);

    try {
      await Promise.race([
        Promise.allSettled(panelRequests),
        new Promise((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        })
      ]);
    } catch {}

    clearTimeout(timeoutId);
    if (quorumTimer) clearTimeout(quorumTimer);

    if (answers.length === 0) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: 'All fusion panel requests failed', type: 'fusion_error', errors: errors.map(e => ({ model: e.model, error: e.error })) }
      }));
      return;
    }

    if (answers.length === 1) {
      this._streamSingleAnswer(res, answers[0], model);
      return;
    }

    await this._callJudgeAndStream(res, answers, judge, messages, model);
  }

  async _callSingleModel(modelName, messages, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('aborted'));

      const mockReq = {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
      };

      let fullContent = '';
      let hasError = false;
      let errorMsg = '';

      const mockRes = {
        writeHead: () => {},
        setHeader: () => {},
        write: (chunk) => {
          if (signal.aborted) return;
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
          if (hasError) {
            reject(new Error(errorMsg || 'Request failed'));
          } else {
            resolve({ content: fullContent });
          }
        },
        statusCode: 200
      };

      mockRes.status = (code) => {
        hasError = code >= 400;
        return mockRes;
      };
      mockRes.json = (data) => {
        if (data.error) {
          hasError = true;
          errorMsg = data.error.message;
        }
        mockRes.end();
        return mockRes;
      };
      mockRes.send = (data) => {
        if (typeof data === 'string' && data.includes('error')) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              hasError = true;
              errorMsg = parsed.error.message;
            }
          } catch {}
        }
        mockRes.end();
        return mockRes;
      };

      signal.addEventListener('abort', () => {
        reject(new Error('aborted'));
      }, { once: true });

      const singleParsed = {
        model: modelName,
        messages: messages,
        stream: true,
        options: {}
      };

      this.router.handleRequest(mockReq, mockRes, singleParsed).catch(reject);
    });
  }

  _streamSingleAnswer(res, answer, originalModel) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const content = answer.content;
    const chunkSize = 4;
    let pos = 0;

    const sendChunk = () => {
      if (pos >= content.length) {
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const end = Math.min(pos + chunkSize, content.length);
      const chunk = content.slice(pos, end);
      pos = end;

      const data = {
        id: 'chatcmpl-fusion-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: originalModel,
        choices: [{ delta: { content: chunk }, index: 0, finish_reason: null }]
      };
      res.write('data: ' + JSON.stringify(data) + '\n\n');
      setTimeout(sendChunk, 10);
    };

    sendChunk();
  }

  async _callJudgeAndStream(res, answers, judgeModel, originalMessages, originalModel) {
    let judgePrompt = FUSION_JUDGE_PROMPT + '\n\n';
    answers.forEach((a, i) => {
      judgePrompt += `## Model ${i + 1} (${a.model}) 回答:\n${a.content}\n\n`;
    });
    judgePrompt += '请综合以上回答给出最终答案：';

    const judgeMessages = [
      ...originalMessages.filter(m => m.role !== 'system'),
      { role: 'user', content: judgePrompt }
    ];

    const hasSystem = originalMessages.some(m => m.role === 'system');
    if (!hasSystem) {
      judgeMessages.unshift({ role: 'system', content: 'You are a helpful assistant that synthesizes the best answer from multiple AI responses.' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    try {
      const judgeParsed = {
        model: judgeModel,
        messages: judgeMessages,
        stream: true,
        options: {}
      };

      const judgeRes = {
        writeHead: () => {},
        setHeader: () => {},
        write: (chunk) => {
          res.write(chunk);
        },
        end: () => {
          res.end();
        },
        status: () => judgeRes,
        json: (data) => {
          if (data.error) {
            this._streamSingleAnswer(res, answers[0], originalModel);
          }
          judgeRes.end();
        },
        send: (data) => judgeRes.end()
      };

      await this.router.handleRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, judgeRes, judgeParsed);
    } catch (err) {
      this._streamSingleAnswer(res, answers[0], originalModel);
    }
  }
}
