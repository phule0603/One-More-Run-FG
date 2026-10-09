# TAM THÁI TỬ

Game endless runner phong cách neon/synthwave, độ khó cao, chơi lại tức thì — có bảng xếp hạng toàn cầu và nhân vật tạo từ ảnh của bạn.
Xây dựng bằng **Next.js (App Router) + HTML5 Canvas + Tailwind CSS**, deploy tự động lên **Vercel**.

## Cách chơi

| Thao tác | Desktop | Mobile |
| --- | --- | --- |
| Nhảy | `Space` / `↑` / `W` / click chuột | Chạm màn hình |
| Nhảy đôi (double jump) — nhân vật lộn vòng | Nhấn lần nữa khi đang ở trên không | Chạm lần nữa |
| Chơi lại | `Space` / click | Chạm |
| Bật/tắt âm thanh | `M` hoặc nút 🔊 | Nút 🔊 |
| Bảng xếp hạng | Nút 🏆 | Nút 🏆 |

- **Chướng ngại vật:** gai (spike), khối (block, có thể đáp lên trên), tia laser (đừng nhảy!), lưỡi cưa lên xuống (canh thời điểm), cầu thang, combo.
- **Điểm số** = quãng đường (m) + 10 điểm cho mỗi coin ◆.
- **Độ khó** tăng dần theo thời gian: tốc độ, mật độ chướng ngại vật và các pattern mới mở dần.
- Vạch **BEST** màu vàng trên đường chạy cho biết kỷ lục quãng đường của bạn.

### Tên người chơi & bảng xếp hạng

- Nhập tên ở màn hình bắt đầu (hoặc ở màn hình Game Over khi vừa lập kỷ lục). Tên hỗ trợ tiếng Việt có dấu, tối đa 16 ký tự.
- Mỗi lần phá kỷ lục cá nhân, điểm được gửi lên **bảng xếp hạng toàn cầu**; màn hình Game Over hiện thứ hạng (`🌐 GLOBAL RANK #12`).
- Nút 🏆 mở bảng xếp hạng với 2 tab: **GLOBAL** (top 10 toàn cầu + hạng của bạn) và **THIS DEVICE** (top 10 trên máy này).
- Mỗi người chơi có một ID ngẫu nhiên lưu trên thiết bị; bảng toàn cầu chỉ giữ điểm cao nhất của mỗi người. Đổi tên thì tên trên bảng cũng đổi theo.

### Nhân vật

Nhân vật là một người chạy neon (dáng chibi) với khăn đỏ bay phía sau:

- **Chạy:** tay chân đánh nhịp theo sải chân, nhịp chạy nhanh dần theo tốc độ.
- **Bật nhảy:** vung tay lên, co gối khi bay lên, duỗi chân đón đất khi rơi; tiếp đất thì khuỵu gối.
- **Nhảy đôi:** lộn một vòng (somersault) trong tư thế ôm gối, để lại vệt bóng mờ của khuôn mặt.
- Hitbox (vùng va chạm) giữ nguyên như trước, nên độ khó không đổi.

### Ảnh làm khuôn mặt nhân vật

- Bấm vào ô nhân vật (hoặc nút **📷 PHOTO**) để chọn ảnh: ảnh được cắt vuông ở giữa, thu nhỏ còn 128×128 và trở thành **khuôn mặt** của nhân vật (đầu tròn viền neon); hạt bụi và mảnh nổ lấy màu từ chính bức ảnh.
- Ảnh được xử lý **hoàn toàn trong trình duyệt** và chỉ lưu trên thiết bị (`localStorage`), không tải lên máy chủ và không hiện trên bảng xếp hạng.
- Nút **↺ DEFAULT** trở về khuôn mặt mặc định (mặt nạ neon).

## Chạy local

Yêu cầu: Node.js ≥ 20.9.

```bash
npm install
npm run dev
```

Mở <http://localhost:3000>. Khi chạy local, bảng xếp hạng dùng bộ nhớ tạm (mất khi tắt server) nên chơi thử được ngay, không cần cấu hình gì.

```bash
npm test            # unit test (Vitest)
npm run typecheck   # kiểm tra TypeScript
npm run build       # build production
npm start           # chạy bản production
```

## Bảng xếp hạng toàn cầu trên Vercel (Upstash Redis — miễn phí)

Trên production, bảng xếp hạng lưu trong Redis. Thiết lập một lần:

1. Vào project trên Vercel → tab **Storage** → **Create Database** → chọn **Upstash** (Redis, gói Free) → **Connect** vào project (chọn tất cả môi trường).
2. Vercel tự thêm biến môi trường `KV_REST_API_URL` và `KV_REST_API_TOKEN` cho project.
3. **Redeploy** (hoặc push một commit mới) — xong.

Chưa thiết lập Redis thì game vẫn chạy bình thường: điểm được lưu trên thiết bị và tab GLOBAL ghi rõ là chưa bật.

Muốn dùng Redis thật khi chạy local: `npx vercel env pull .env.local` rồi `npm run dev`.

| Biến môi trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Có (để bật bảng toàn cầu) | Do tích hợp Upstash của Vercel tự thêm. Cũng nhận tên `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` |
| `LEADERBOARD_SECRET` | Không | Khoá ký run token; mặc định suy ra từ token Redis |
| `LEADERBOARD_STORE=memory` | Không | Dùng bộ nhớ tạm cả ở production (chỉ để thử nghiệm) |

**Chống gian lận:** game chạy trên trình duyệt nên không thể chặn tuyệt đối, nhưng server kiểm tra:

- mỗi lượt chơi phải có *run token* do server ký lúc bắt đầu, chỉ dùng được một lần, và thời gian chơi khai báo không được dài hơn thời gian thực kể từ lúc cấp token;
- điểm phải khớp quãng đường + coin, quãng đường không vượt quá mức tối đa có thể theo đường cong tốc độ của game, số coin hợp lý;
- giới hạn số lần gửi điểm theo IP; tên được lọc ký tự.

## Deploy tự động (GitHub Actions → Vercel)

File `.github/workflows/ci-deploy.yml` chạy mỗi lần push:

1. **Kiểm tra:** `npm ci` → typecheck → unit test → build. Lỗi ở bước nào thì không deploy.
2. **Deploy:** push lên nhánh `main` → **Production**; push lên nhánh khác → bản **Preview** riêng. Link deploy hiện trong trang tóm tắt của lần chạy (tab *Actions*).

Thiết lập một lần:

1. Trên máy của bạn, trong thư mục dự án:
   ```bash
   npx vercel login
   npx vercel link        # tạo / liên kết project, sinh file .vercel/project.json
   cat .vercel/project.json   # lấy "orgId" và "projectId"
   ```
2. Tạo token tại <https://vercel.com/account/tokens>.
3. Trên GitHub: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, thêm 3 secret:
   `VERCEL_TOKEN`, `VERCEL_ORG_ID` (= `orgId`), `VERCEL_PROJECT_ID` (= `projectId`).
4. Push lên GitHub — mọi lần push sau đều tự deploy.

Chưa thêm secrets thì workflow vẫn chạy kiểm tra và chỉ bỏ qua bước deploy (có ghi chú trong log).
Đổi nhánh production: sửa `PRODUCTION_BRANCH` trong workflow.

> **Chỉ dùng một cách deploy tự động.** Cách đơn giản hơn (không cần secrets, nhưng không chạy test trước khi deploy) là kết nối repo trong Vercel: <https://vercel.com/new> → **Import** repo. Nếu dùng cách này, hãy xoá job `deploy` trong workflow để tránh deploy hai lần; ngược lại, nếu dùng GitHub Actions thì đừng import repo bằng Git Integration.

## Deploy thủ công bằng CLI

```bash
npx vercel login    # chỉ cần 1 lần
npx vercel          # bản Preview (giữ mặc định khi được hỏi; project name gợi ý: tam-thai-tu)
npx vercel --prod   # Production
```

> **Lỗi `No existing credentials found`?** Bạn chưa đăng nhập — chạy `npx vercel login` trước, trong terminal thường (bên trong công cụ AI như Cursor/Claude Code, Vercel CLI chạy ở chế độ không tương tác nên không hỏi đăng nhập).
> Muốn deploy ngay khi chưa có tài khoản: `npx vercel deploy --temporary` tạo bản deploy tạm thời, có thể nhận (claim) về tài khoản sau.

## Cấu trúc thư mục

```
app/
  page.tsx, layout.tsx, globals.css, icon.svg
  api/leaderboard/route.ts        # GET top 10 + hạng của bạn · POST gửi điểm · PATCH đổi tên
  api/leaderboard/token/route.ts  # POST cấp run token khi bắt đầu lượt chơi
components/
  OneMoreRunGame.tsx              # canvas + overlay Start / Game Over
  PlayerCard.tsx                  # ô nhân vật (ảnh) + tên người chơi
  LeaderboardDialog.tsx           # bảng xếp hạng (GLOBAL / THIS DEVICE)
hooks/
  useOneMoreRun.ts                # engine: game loop, physics, spawner, renderer, particles, âm thanh
  useLeaderboard.ts               # tên, ID người chơi, bảng trên máy, gửi điểm
  useAvatar.ts                    # tải / lưu / xoá ảnh nhân vật
lib/
  game-config.ts                  # hằng số dùng chung cho game và server (tốc độ, cách tính điểm)
  character.ts                    # nhân vật hình người: tư thế chạy / nhảy / lộn vòng / tiếp đất và cách vẽ
  avatar.ts                       # cắt, thu nhỏ ảnh và lấy bảng màu (chạy trong trình duyệt)
  leaderboard/shared.ts           # kiểu dữ liệu, lọc tên, kiểm tra tính hợp lý của điểm
  leaderboard/token.ts            # ký / xác thực run token (HMAC)
  leaderboard/store.ts            # lưu trữ: Redis (Upstash REST) hoặc bộ nhớ tạm
tests/                            # unit test (Vitest) + giả lập Upstash
.github/workflows/ci-deploy.yml   # CI/CD
vercel.json
```

## Kiến trúc engine (`hooks/useOneMoreRun.ts`)

- **Game loop:** `requestAnimationFrame` + bước vật lý cố định 1/120 s → mượt và ổn định trên mọi tần số màn hình (60/120/144 Hz).
- **Input không độ trễ:** cú nhảy xử lý ngay trong event handler, kèm *jump buffer* (130 ms) và *coyote time* (90 ms).
- **Restart tức thì:** chỉ reset state trong bộ nhớ, không reload trang (~30 ms). Khoá 0,3 s sau khi chết để tránh bấm nhầm. Gửi điểm chạy nền, không làm chậm lượt chơi mới.
- **Responsive:** canvas co giãn theo màn hình, hỗ trợ Retina. Màn hình hẹp hiển thị ít đường chạy hơn nên tốc độ được giảm tương ứng để thời gian phản xạ như nhau; điểm số được chuẩn hoá nên vẫn so sánh được giữa các thiết bị.
- **Nhân vật:** khung xương 2D (đùi, cẳng chân, cánh tay, đầu) với các tư thế được nội suy: sải chạy, bật nhảy, lộn vòng, khuỵu gối; khi ở dưới đất, thân được hạ xuống để bàn chân luôn chạm mặt đường.
- **Game feel:** screen shake, flash, particle, sóng xung kích, vệt mờ, squash & stretch, âm thanh tổng hợp bằng WebAudio (không cần file asset).
- **React chỉ render overlay** khi đổi trạng thái; HUD trong lúc chơi vẽ thẳng lên canvas.

## Tinh chỉnh độ khó

| Hằng số | Ở đâu | Ý nghĩa |
| --- | --- | --- |
| `BASE_SPEED` / `MAX_SPEED`, `RAMP_TIME` | `lib/game-config.ts` | Tốc độ khởi đầu / tối đa, độ khó tăng nhanh hay chậm (giây) |
| `COIN_VALUE` | `lib/game-config.ts` | Điểm mỗi coin |
| `GRAVITY`, `JUMP_V`, `DJUMP_V` | `hooks/useOneMoreRun.ts` | Trọng lực, lực nhảy, lực nhảy đôi |
| `COYOTE`, `BUFFER` | `hooks/useOneMoreRun.ts` | Độ "dễ tính" của nút nhảy |
| `RETRY_LOCK` | `hooks/useOneMoreRun.ts` | Thời gian khoá input sau khi chết |

Các hằng số trong `lib/game-config.ts` cũng được server dùng để kiểm tra điểm, nên bảng xếp hạng luôn khớp với luật chơi. Tỉ lệ xuất hiện từng loại chướng ngại vật nằm trong `spawnPattern()`.
