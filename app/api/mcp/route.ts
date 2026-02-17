/**
 * MCP API
 * Manage MCP server connections and discover tools
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMCPManager, type MCPServerConfig } from '@/lib/mcp';

// GET /api/mcp - List MCP servers and their tools
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');

    if (action === 'tools') {
      // Get all tool schemas
      const manager = getMCPManager();
      const tools = manager.getAllToolSchemas();
      return NextResponse.json({ tools });
    }

    // Get connected servers
    const manager = getMCPManager();
    const connectedServers = manager.getConnectedServers();

    // Get server configs from database
    const { data: servers, error } = await supabase
      .from('mcp_servers')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[MCP API] Error fetching servers:', error);
      return NextResponse.json({ error: 'Failed to fetch servers' }, { status: 500 });
    }

    // Add connection status
    const serversWithStatus = (servers || []).map(server => ({
      ...server,
      isConnected: connectedServers.includes(server.name),
    }));

    return NextResponse.json({ servers: serversWithStatus });
  } catch (error) {
    console.error('[MCP API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/mcp - Add/connect a new MCP server
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, ...data } = body;

    if (action === 'connect') {
      // Connect to an MCP server
      const { url, name } = data;

      if (!url || !name) {
        return NextResponse.json({ error: 'url and name are required' }, { status: 400 });
      }

      const manager = getMCPManager();
      const result = await manager.addServer({
        name,
        transportType: 'http',
        url,
        enabled: true,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      // Store in database
      const { error: dbError } = await supabase.from('mcp_servers').upsert({
        user_id: user.id,
        name,
        transport_type: 'http',
        url,
        enabled: true,
        status: 'connected',
      });

      if (dbError) {
        console.error('[MCP API] Error saving server:', dbError);
      }

      const tools = manager.getAllToolSchemas().filter(t => t.function.name.startsWith(`mcp_${name}_`));

      return NextResponse.json({
        success: true,
        server: { name, url },
        toolsDiscovered: tools.length,
        tools,
      });
    }

    if (action === 'execute') {
      // Execute an MCP tool
      const { toolName, args } = data;

      if (!toolName) {
        return NextResponse.json({ error: 'toolName is required' }, { status: 400 });
      }

      const manager = getMCPManager();

      if (!manager.hasTool(toolName)) {
        return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
      }

      const result = await manager.executeTool(toolName, args || {});

      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[MCP API] Error:', errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// DELETE /api/mcp - Disconnect/remove an MCP server
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ error: 'Server name is required' }, { status: 400 });
    }

    // Disconnect from manager
    const manager = getMCPManager();
    manager.removeServer(name);

    // Update database
    await supabase
      .from('mcp_servers')
      .update({ status: 'disconnected' })
      .eq('user_id', user.id)
      .eq('name', name);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MCP API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
