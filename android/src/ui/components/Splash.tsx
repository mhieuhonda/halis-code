/** Boot splash — brand mark, quiet dots. */
import logoUrl from '../../assets/logo.png'
import nameUrl from '../../assets/name.png'

export function Splash() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center" style={{ background: 'var(--hal-bg)' }}>
      <div className="flex flex-col items-center">
        <img src={logoUrl} alt="Halis Code" width={84} height={84} style={{ borderRadius: 20 }} draggable={false} />
        <img src={nameUrl} alt="" style={{ height: 26, marginTop: 18 }} draggable={false} />
        <div className="mt-4 flex items-center">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  )
}
