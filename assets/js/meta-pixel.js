(() => {
  const id = '4419205235001105';
  const rota = location.pathname.replace(/\/+$/, '');
  const nicho = {
    '/adv': 'advocacia',
    '/odonto': 'odontologia'
  }[rota];

  if (location.hostname !== 'oferta.idkbrasil.com' || !nicho) return;
  if (window._IDK_CAPTACAO_4419205235001105_) return;
  window._IDK_CAPTACAO_4419205235001105_ = true;

  !function(f,b,e,v,n,t,s) {
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
    s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);
  }(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', id);
  window.fbq('trackSingle', id, 'PageView');

  const enviados = new Set();
  const cookie = nome =>
    document.cookie.split('; ')
      .find(p => p.startsWith(nome + '='))
      ?.slice(nome.length + 1);

  window.IDKMeta = Object.freeze({
    prepararCadastro() {
      const params = new URLSearchParams(location.search);
      const utms = {};

      for (const chave of [
        'utm_source', 'utm_medium', 'utm_campaign',
        'utm_content', 'utm_term'
      ]) {
        if (params.has(chave)) utms[chave] = params.get(chave);
      }

      return {
        event_id: crypto.randomUUID(),
        nicho,
        event_source_url: location.origin + rota + '/',
        fbp: cookie('_fbp'),
        fbc: cookie('_fbc'),
        fbclid: params.get('fbclid') || undefined,
        utms
      };
    },

    cadastroConfirmado(eventId) {
      if (typeof eventId !== 'string' ||
          !eventId || enviados.has(eventId)) return;

      window.fbq('trackSingle', id, 'Lead', {
        content_name: 'Solicitação de proposta IDK Professionals',
        content_category: nicho
      }, { eventID: eventId });

      enviados.add(eventId);
    },

    cliqueWhatsApp() {
      window.fbq('trackSingle', id, 'Contact', {
        content_name: 'Clique no WhatsApp',
        content_category: nicho
      }, { eventID: crypto.randomUUID() });
    }
  });

  document.addEventListener('click', evento => {
    const link = evento.target?.closest?.('a[href]');
    if (!link) return;

    const host = new URL(link.href, location.href).hostname;

    if ([
      'wa.me', 'api.whatsapp.com', 'web.whatsapp.com'
    ].includes(host)) {
      window.IDKMeta.cliqueWhatsApp();
    }
  });
})();
