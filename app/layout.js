import "./globals.css";

export const metadata = {
  title: "เฉาก๊วย — สถิติและวิเคราะห์สลากกินแบ่งรัฐบาล",
  description:
    "วิเคราะห์สถิติผลสลากกินแบ่งรัฐบาลย้อนหลัง ค้นหารูปแบบ และดูคำทำนายเชิงสถิติ เพื่อการวิจัยและความบันเทิงเท่านั้น",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
