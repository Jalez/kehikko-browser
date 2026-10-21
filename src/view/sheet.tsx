import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** A view laid over the browser's screen: a title, a close button, and what it holds. The screen stays mounted below it. */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose(): void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="bg-background absolute inset-0 flex flex-col overflow-auto" role="dialog" aria-label={title}>
      <div className="bg-background sticky top-0 z-10 flex items-center gap-1 border-b px-3 py-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </div>
  )
}
