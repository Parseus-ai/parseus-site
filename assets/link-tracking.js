/* Link click tracking (unchanged behaviour from the original inline script). */
(function(){
  function track(name, props){
    try{
      if(window.__cfBeacon && typeof window.__cfBeacon.trackEvent === 'function'){
        window.__cfBeacon.trackEvent(name, props);
      } else if(navigator.sendBeacon){
        var payload = JSON.stringify({n:name,p:props||{},u:location.pathname});
        navigator.sendBeacon('https://cloudflareinsights.com/cdn-cgi/rum?', payload);
      }
    }catch(e){}
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if(!a) return;
    var href = a.getAttribute('href') || '';
    var label = (a.textContent || '').trim().slice(0,60);
    track('link_click', {href:href, label:label, page:location.pathname});
  }, true);
})();
