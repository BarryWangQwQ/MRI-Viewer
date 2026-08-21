/**
 * Stop a wheel/trackpad gesture from scrolling the host page, without
 * cancelling an inner ScrollArea (or other overflow scroller) that can
 * still move in this direction.
 */
export function containOverscroll(event: WheelEvent): void {
  if (event.defaultPrevented) return
  const root = event.currentTarget
  let node: Element | null = event.target instanceof Element ? event.target : null
  while (node && node !== root) {
    if (node instanceof HTMLElement && canScroll(node, event)) return
    node = node.parentElement
  }
  event.preventDefault()
}

function canScroll(el: HTMLElement, event: WheelEvent): boolean {
  const style = getComputedStyle(el)
  const isViewport = el.dataset.slot === 'scroll-area-viewport'
  const y = isViewport || style.overflowY === 'auto' || style.overflowY === 'scroll'
  const x = isViewport || style.overflowX === 'auto' || style.overflowX === 'scroll'
  const dy = event.deltaY
  const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX

  if (y && dy !== 0 && !event.shiftKey) {
    const max = el.scrollHeight - el.clientHeight
    if (max > 1 && ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop < max - 1))) {
      return true
    }
  }
  if (x && dx !== 0) {
    const max = el.scrollWidth - el.clientWidth
    if (max > 1 && ((dx < 0 && el.scrollLeft > 0) || (dx > 0 && el.scrollLeft < max - 1))) {
      return true
    }
  }
  return false
}
