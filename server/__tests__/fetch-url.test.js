const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, isPrivateIP, isSupportedContentType } = require('../fetch-url');

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

describe('isSupportedContentType', () => {
  it('允許 text/html', () => {
    assert.equal(isSupportedContentType('text/html'), true);
  });

  it('允許帶 charset 的 text/html', () => {
    assert.equal(isSupportedContentType('text/html; charset=utf-8'), true);
  });

  it('允許 application/xhtml+xml', () => {
    assert.equal(isSupportedContentType('application/xhtml+xml'), true);
  });

  it('允許 application/pdf', () => {
    assert.equal(isSupportedContentType('application/pdf'), true);
  });

  it('允許 DOCX MIME type', () => {
    assert.equal(isSupportedContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  });

  it('允許 XLSX MIME type', () => {
    assert.equal(isSupportedContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
  });

  it('允許 PPTX MIME type', () => {
    assert.equal(isSupportedContentType('application/vnd.openxmlformats-officedocument.presentationml.presentation'), true);
  });

  it('允許 text/csv', () => {
    assert.equal(isSupportedContentType('text/csv'), true);
  });

  it('允許 application/epub+zip', () => {
    assert.equal(isSupportedContentType('application/epub+zip'), true);
  });

  it('拒絕 image/png', () => {
    assert.equal(isSupportedContentType('image/png'), false);
  });

  it('拒絕 image/jpeg', () => {
    assert.equal(isSupportedContentType('image/jpeg'), false);
  });

  it('拒絕 application/json', () => {
    assert.equal(isSupportedContentType('application/json'), false);
  });

  it('拒絕 application/octet-stream', () => {
    assert.equal(isSupportedContentType('application/octet-stream'), false);
  });

  it('拒絕 video/mp4', () => {
    assert.equal(isSupportedContentType('video/mp4'), false);
  });

  it('拒絕 text/plain', () => {
    assert.equal(isSupportedContentType('text/plain'), false);
  });

  it('大小寫不敏感', () => {
    assert.equal(isSupportedContentType('TEXT/HTML'), true);
    assert.equal(isSupportedContentType('Application/PDF'), true);
  });

  it('拒絕空字串', () => {
    assert.equal(isSupportedContentType(''), false);
  });

  it('拒絕 undefined', () => {
    assert.equal(isSupportedContentType(undefined), false);
  });
});

const { isDirectDownloadType } = require('../browser');

describe('isDirectDownloadType (整合)', () => {
  it('PDF 走直接下載', () => {
    assert.equal(isDirectDownloadType('application/pdf'), true);
  });

  it('HTML 走渲染', () => {
    assert.equal(isDirectDownloadType('text/html'), false);
    assert.equal(isDirectDownloadType('text/html; charset=utf-8'), false);
  });

  it('未知類型走渲染', () => {
    assert.equal(isDirectDownloadType('application/json'), false);
  });
});
