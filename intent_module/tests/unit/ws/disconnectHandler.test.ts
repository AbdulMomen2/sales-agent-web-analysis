/**
 * Tests for disconnect handler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { handleDisconnect } from '../../../src/ws/disconnectHandler.js';
import { type ConnectionMap } from '../../../src/ws/connectionHandler.js';

describe('disconnectHandler', () => {
  let connections: ConnectionMap;

  beforeEach(() => {
    connections = new Map();
    connections.set('s1', {} as any);
    connections.set('s2', {} as any);
  });

  it('removes the session from the connection map', () => {
    handleDisconnect('s1', connections);
    expect(connections.has('s1')).toBe(false);
    expect(connections.has('s2')).toBe(true);
  });

  it('handles disconnect for unknown session (no-op)', () => {
    handleDisconnect('unknown', connections);
    expect(connections.size).toBe(2);
  });

  it('does not throw when store is omitted', () => {
    expect(() => handleDisconnect('s1', connections)).not.toThrow();
  });
});
