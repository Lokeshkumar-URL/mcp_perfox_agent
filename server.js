import express from 'express';
import cors from 'cors';
import { mcpTools } from './mcp-server.js';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'url-factory-mcp',
    mcpEndpoint: '/mcp',
    healthEndpoint: '/mcp/health',
    message: 'Send MCP JSON-RPC requests to /mcp using POST.'
  });
});

app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request' }
    });
  }

  try {
    let result;

    if (method === 'initialize') {
      res.json({ jsonrpc: '2.0', result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'url-factory-mcp', version: '1.0.0' } }, id });
      return;
    }
    if (method === 'tools/list') {
      const tools = Object.entries(mcpTools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));
      result = { tools };
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const tool = mcpTools[name];

      if (!tool) {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Tool not found: ${name}` }
        });
      }

      const toolResult = await tool.handler(args || {});
      result = {
        content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
      };
    } else {
      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error.message }
    });
  }
});

app.get('/mcp/health', (req, res) => {
  res.json({ status: 'ok', service: 'url-factory-mcp', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`URL Factory MCP Service running at http://localhost:${PORT}`);
});
