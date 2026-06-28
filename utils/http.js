/**
 * Parse JSON body from request
 */
export async function parseBody(req, maxSize = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        if (data === '') {
          resolve({});
        } else {
          resolve(JSON.parse(data));
        }
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
export function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 * Supports two call signatures:
 *   sendError(res, statusCode, message)
 *   sendError(res, error, statusCode?)
 */
export function sendError(res, arg1, arg2 = 500) {
  let status, message;
  if (typeof arg1 === 'number') {
    status = arg1;
    message = typeof arg2 === 'string' ? arg2 : 'Error';
  } else {
    status = typeof arg2 === 'number' ? arg2 : 500;
    message = arg1?.message || 'Internal server error';
  }
  
  const errorObj = {
    error: {
      message: message,
      code: status
    }
  };
  sendJSON(res, errorObj, status);
}

/**
 * Write SSE (Server-Sent Events) chunk
 */
export function writeSSE(res, event, data) {
  if (event) {
    res.write(`event: ${event}\n`);
  }
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Initialize SSE response
 */
export function initSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
}

/**
 * End SSE response
 */
export function endSSE(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * CORS preflight
 */
export function handleCORS(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return true;
  }
  return false;
}
