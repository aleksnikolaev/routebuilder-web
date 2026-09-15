// Carried over from the published page as is.
// Reveal-on-scroll
  (function(){
    var els = document.querySelectorAll('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function(el){ el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function(el){ io.observe(el); });
  })();

// Auto-update temporal markers
document.querySelectorAll('[data-runtime-from]').forEach(el => {
  const years = new Date().getFullYear() - parseInt(el.dataset.runtimeFrom);
  el.textContent = years + ' yr';
});
document.querySelectorAll('[data-current-date]').forEach(el => {
  const d = new Date();
  el.textContent = d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0');
});

// Page views and contact clicks. No cookies, no identifiers: the server keeps
// only a salted hash of the address, for rate limiting.
(function () {
	function send(event) {
		var payload = JSON.stringify({ event: event, path: location.pathname });
		if (navigator.sendBeacon) {
			navigator.sendBeacon('/api/event', payload);
		} else {
			fetch('/api/event', { method: 'POST', body: payload, keepalive: true });
		}
	}
	send('page_view');
	document.addEventListener('click', function (e) {
		var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
		if (!a) return;
		var href = a.getAttribute('href') || '';
		if (href.indexOf('mailto:') === 0) send('click_email');
		else if (href.indexOf('https://wa.me/') === 0) send('click_whatsapp');
		else if (href.indexOf('https://www.linkedin.com/') === 0) send('click_linkedin');
	});
})();
