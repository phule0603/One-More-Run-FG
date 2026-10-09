# ONE MORE RUN

Game endless runner phong cách neon/synthwave, độ khó cao, chơi lại tức thì.
Xây dựng bằng **Next.js (App Router) + HTML5 Canvas + Tailwind CSS**, sẵn sàng deploy lên **Vercel**.

## Cách chơi

| Thao tác | Desktop | Mobile |
| --- | --- | --- |
| Nhảy | `Space` / `↑` / `W` / click chuột | Chạm màn hình |
| Nhảy đôi (double jump) | Nhấn lần nữa khi đang ở trên không | Chạm lần nữa |
| Chơi lại | `Space` / click | Chạm |
| Bật/tắt âm thanh | `M` hoặc nút 🔊 | Nút 🔊 |

- **Chướng ngại vật:** gai (spike), khối (block, có thể đáp lên trên), tia laser (đừng nhảy!), lưỡi cưa lên xuống (canh thời điểm), cầu thang, combo.
- **Điểm số** = quãng đường (m) + 10 điểm cho mỗi coin ◆. Điểm cao nhất lưu trong `localStorage`.
- **Độ khó** tăng dần theo thời gian: tốc độ chạy, khoảng cách chướng ngại vật và các pattern mới (laser, cưa, cầu thang, combo) mở dần.
- Vạch **BEST** màu vàng trên đường chạy cho biết kỷ lục quãng đường của bạn.

## Chạy local

Yêu cầu: Node.js ≥ 20.9.

```bash
npm install
npm run dev
```

Mở <http://localhost:3000>.

Kiểm tra bản production:

```bash
npm run build
npm start
```

## Deploy lên Vercel (Free Plan)

Dự án đã có sẵn `vercel.json` (framework `nextjs`), không cần cấu hình thêm.

```bash
npx vercel login    # chỉ cần làm 1 lần: mở trình duyệt để đăng nhập (GitHub / Google / Email)
npx vercel          # tạo bản Preview (trả lời vài câu hỏi, giữ mặc định)
npx vercel --prod   # deploy lên Production
```

> **Lỗi `No existing credentials found`?** Bạn chưa đăng nhập — chạy `npx vercel login` trước.
> Nên chạy trong terminal thường: khi chạy bên trong công cụ AI (Cursor, Claude Code…), Vercel CLI tự chuyển sang chế độ không tương tác nên không hỏi đăng nhập.
> Muốn deploy ngay mà chưa cần tài khoản: `npx vercel deploy --temporary` tạo bản deploy tạm thời, có thể nhận (claim) về tài khoản sau.

Khi CLI hỏi, cứ nhấn Enter để chấp nhận mặc định:

- *Set up and deploy?* → `Y`
- *Which scope?* → tài khoản của bạn
- *Link to existing project?* → `N`
- *Project name?* → `one-more-run` (hoặc tên tuỳ ý)
- *In which directory is your code located?* → `./`

Cách khác: đẩy repo lên GitHub rồi vào <https://vercel.com/new> → **Import** repo → **Deploy**.
Mỗi lần push lên nhánh chính Vercel sẽ tự deploy lại.

## Cấu trúc thư mục

```
app/
  layout.tsx            # metadata, viewport (chặn zoom trên mobile)
  page.tsx              # trang duy nhất, render game toàn màn hình
  globals.css           # Tailwind v4 + theme màu neon + animation nhấp nháy
  icon.svg              # favicon
components/
  OneMoreRunGame.tsx    # Client Component: <canvas> + overlay Start / Game Over (Tailwind)
hooks/
  useOneMoreRun.ts      # toàn bộ engine: game loop, physics, spawner, renderer, particles, âm thanh
vercel.json
```

## Kiến trúc engine (`hooks/useOneMoreRun.ts`)

- **Game loop:** `requestAnimationFrame` + bước vật lý cố định 1/120 s (fixed timestep) → mượt và ổn định trên mọi tần số màn hình (60/120/144 Hz).
- **Input không độ trễ:** cú nhảy được xử lý ngay trong event handler (không chờ frame kế tiếp), kèm *jump buffer* (130 ms) và *coyote time* (90 ms) để thao tác "ăn" hơn.
- **Restart tức thì:** chỉ reset state trong bộ nhớ, không reload trang (đo được ~30 ms). Có khoá 0,3 s sau khi chết để tránh bấm nhầm.
- **Responsive:** canvas tự co giãn theo màn hình, hỗ trợ màn hình Retina (DPR tối đa 2). Màn hình hẹp (điện thoại dọc) hiển thị ít đường chạy hơn nên tốc độ thế giới được giảm tương ứng để thời gian phản xạ như nhau; điểm số được chuẩn hoá nên vẫn so sánh được.
- **Game feel:** screen shake, flash, particle (nhảy, đáp đất, nhặt coin, nổ khi chết), vòng sóng xung kích, vệt mờ (trail), squash & stretch, âm thanh tổng hợp bằng WebAudio (không cần file asset).
- **React chỉ render overlay** khi đổi trạng thái (ready → playing → dead), HUD trong lúc chơi vẽ thẳng lên canvas nên không re-render mỗi frame.

## Tinh chỉnh độ khó

Các hằng số ở đầu `hooks/useOneMoreRun.ts`:

| Hằng số | Ý nghĩa |
| --- | --- |
| `BASE_SPEED` / `MAX_SPEED` | Tốc độ khởi đầu / tối đa |
| `RAMP_TIME` | Độ khó tăng nhanh hay chậm (giây) |
| `GRAVITY`, `JUMP_V`, `DJUMP_V` | Trọng lực, lực nhảy, lực nhảy đôi |
| `COYOTE`, `BUFFER` | Độ "dễ tính" của nút nhảy |
| `RETRY_LOCK` | Thời gian khoá input sau khi chết |
| `COIN_VALUE` | Điểm mỗi coin |

Tỉ lệ xuất hiện từng loại chướng ngại vật nằm trong `spawnPattern()`.
