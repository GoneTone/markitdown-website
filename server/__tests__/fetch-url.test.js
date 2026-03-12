const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, isPrivateIP } = require('../fetch-url');

describe('validateUrl', () => {
  it('接受有效的 http URL', () => {
    const result = validateUrl('http://example.com');
    assert.ok(result.url);
    assert.equal(result.url.href, 'http://example.com/');
  });

  it('接受有效的 https URL', () => {
    const result = validateUrl('https://example.com/page');
    assert.ok(result.url);
  });

  it('拒絕空值', () => {
    const result = validateUrl('');
    assert.equal(result.status, 400);
    assert.ok(result.error);
  });

  it('拒絕 undefined', () => {
    const result = validateUrl(undefined);
    assert.equal(result.status, 400);
  });

  it('拒絕無效 URL', () => {
    const result = validateUrl('not-a-url');
    assert.equal(result.status, 400);
  });

  it('拒絕 ftp 協定', () => {
    const result = validateUrl('ftp://example.com');
    assert.equal(result.status, 400);
  });

  it('拒絕 file 協定', () => {
    const result = validateUrl('file:///etc/passwd');
    assert.equal(result.status, 400);
  });

  it('拒絕 javascript 協定', () => {
    const result = validateUrl('javascript:alert(1)');
    assert.equal(result.status, 400);
  });
});

describe('isPrivateIP', () => {
  it('封鎖 127.0.0.1 (loopback)', () => {
    assert.equal(isPrivateIP('127.0.0.1'), true);
  });

  it('封鎖 127.x.x.x 範圍', () => {
    assert.equal(isPrivateIP('127.255.0.1'), true);
  });

  it('封鎖 10.x.x.x (class A private)', () => {
    assert.equal(isPrivateIP('10.0.0.1'), true);
    assert.equal(isPrivateIP('10.255.255.255'), true);
  });

  it('封鎖 172.16-31.x.x (class B private)', () => {
    assert.equal(isPrivateIP('172.16.0.1'), true);
    assert.equal(isPrivateIP('172.31.255.255'), true);
  });

  it('允許 172.15.x.x 和 172.32.x.x (非私有)', () => {
    assert.equal(isPrivateIP('172.15.0.1'), false);
    assert.equal(isPrivateIP('172.32.0.1'), false);
  });

  it('封鎖 192.168.x.x (class C private)', () => {
    assert.equal(isPrivateIP('192.168.1.1'), true);
  });

  it('封鎖 169.254.x.x (link-local)', () => {
    assert.equal(isPrivateIP('169.254.1.1'), true);
  });

  it('封鎖 ::1 (IPv6 loopback)', () => {
    assert.equal(isPrivateIP('::1'), true);
  });

  it('封鎖 fe80: (IPv6 link-local)', () => {
    assert.equal(isPrivateIP('fe80::1'), true);
  });

  it('封鎖 fc00:/fd (IPv6 ULA)', () => {
    assert.equal(isPrivateIP('fc00::1'), true);
    assert.equal(isPrivateIP('fd12::1'), true);
  });

  it('允許公開 IP', () => {
    assert.equal(isPrivateIP('8.8.8.8'), false);
    assert.equal(isPrivateIP('1.1.1.1'), false);
    assert.equal(isPrivateIP('203.0.113.1'), false);
  });
});
