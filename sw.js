/* AF 대시보드 서비스워커
 *
 * 안전 원칙 (데이터 보호):
 *  1) Firebase · Google 로그인 · CDN · Cloudinary 등 "다른 도메인" 요청은 절대 가로채지 않는다.
 *     → 데이터 읽기/쓰기 경로는 서비스워커와 완전히 무관하다.
 *  2) index.html(화면)은 캐시하지 않는다. 항상 서버 최신본을 받는다.
 *     → 옛날 버전 코드가 캐시로 실행되어 데이터를 잘못 쓰는 일이 생기지 않는다.
 *     → 오프라인이면 "연결 후 다시 열어주세요" 안내만 보여준다 (오프라인 편집 차단).
 *  3) 캐시하는 것은 아이콘/매니페스트 같은 정적 파일뿐이다.
 *
 * 긴급 해제 방법: 이 파일 내용을 아래 3줄로 바꿔 배포하면 모든 사용자에게서 서비스워커가 제거된다.
 *   self.addEventListener('install', () => self.skipWaiting());
 *   self.addEventListener('activate', e => e.waitUntil(self.registration.unregister()));
 *   (데이터에는 영향 없음 — 앱 설치 기능만 일반 웹페이지로 돌아감)
 */
const SW_VERSION = 'af-sw-v1';
const STATIC_CACHE = SW_VERSION + '-static';
const STATIC_ASSETS = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // 개별 추가 — 파일 하나가 없어도 설치 자체는 실패하지 않도록
      Promise.all(STATIC_ASSETS.map((u) => cache.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.indexOf('af-sw-') === 0 && k !== STATIC_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>오프라인 — AF 대시보드</title></head>' +
  '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;height:100vh;">' +
  '<div style="text-align:center;padding:24px;">' +
  '<div style="font-size:40px;margin-bottom:10px;">📡</div>' +
  '<div style="font-size:17px;font-weight:800;color:#1f2937;margin-bottom:6px;">인터넷에 연결되어 있지 않습니다</div>' +
  '<div style="font-size:13px;color:#6b7280;margin-bottom:18px;">데이터 보호를 위해 오프라인에서는 대시보드를 열지 않습니다.<br>연결 후 다시 시도해주세요.</div>' +
  '<button onclick="location.reload()" style="border:none;background:#6366f1;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;cursor:pointer;">다시 시도</button>' +
  '</div></body></html>';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                          // 쓰기 요청은 절대 개입하지 않음
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;           // Firebase/CDN 등 외부 요청은 브라우저 기본 동작 그대로

  // 화면(index.html): 항상 네트워크 — 실패 시 오프라인 안내만
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    );
    return;
  }

  // 정적 아이콘/매니페스트: 캐시 우선
  const isStatic = STATIC_ASSETS.some((p) => url.pathname.endsWith(p.replace('./', '/')));
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req))
    );
  }
  // 그 외 같은 도메인 요청도 브라우저 기본 동작
});

// 알림 클릭 → 열려 있는 대시보드 창으로 포커스 + 해당 이슈/채팅 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.postMessage({ type: 'af-notif-click', data: data });
          return;
        }
      } catch (e) {}
    }
    const target = data.issueId ? './?issue=' + encodeURIComponent(data.issueId) : './';
    await self.clients.openWindow(target);
  })());
});
