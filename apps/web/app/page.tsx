import { AppShell } from '@/components/app-shell'

export default function Home() {
  return (
    <AppShell active="library">
      <div className="mx-auto flex max-w-[1020px] flex-col gap-7 px-8 py-11">
        <div>
          <div className="text-[25px] font-bold">คลังวิดีโอ</div>
          <div className="mt-1 text-[13.5px] text-muted">
            ทุกอย่างอยู่ในเครื่องของคุณ ไม่มีอะไรออกสู่อินเทอร์เน็ต
          </div>
        </div>
      </div>
    </AppShell>
  )
}
