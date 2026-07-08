import React, { useState, useMemo } from 'react';


// Liste initiale des produits de la brasserie de Kombucha (inspirée du Jotform + fiches techniques)
const INITIAL_PRODUCTS = [
  { id: '1l_pomme', name: 'Kombucha Pomme - Sureau', format: '1L', packing: 'Carton de 6', priceHT: 18.90, available: true, color: '#D4E2C6', flavor: 'pomme' },
  { id: '1l_gingembre', name: 'Kombucha Gingembre - Citron', format: '1L', packing: 'Carton de 6', priceHT: 19.50, available: true, color: '#EED9B3', flavor: 'gingembre' },
  { id: '1l_framboise', name: 'Kombucha Framboise - Hibiscus', format: '1L', packing: 'Carton de 6', priceHT: 19.50, available: true, color: '#F2B9B3', flavor: 'framboise' },
  { id: '1l_mangue', name: 'Kombucha Mangue - Vanille', format: '1L', packing: 'Carton de 6', priceHT: 20.40, available: false, color: '#F1E3A5', flavor: 'mangue' }, // Rupture simulée
  { id: '1l_orange', name: 'Kombucha Orange Sanguine', format: '1L', packing: 'Carton de 6', priceHT: 19.50, available: true, color: '#ECA08B', flavor: 'orange' },
  { id: '1l_cola', name: 'Kombucha Cola - Chaï', format: '1L', packing: 'Carton de 6', priceHT: 20.40, available: true, color: '#D4BFA7', flavor: 'cola' },
  
  { id: '35cl_pomme', name: 'Kombucha Pomme - Sureau', format: '35cL', packing: 'Carton de 12', priceHT: 21.60, available: true, color: '#D4E2C6', flavor: 'pomme' },
  { id: '35cl_gingembre', name: 'Kombucha Gingembre - Citron', format: '35cL', packing: 'Carton de 12', priceHT: 22.80, available: true, color: '#EED9B3', flavor: 'gingembre' },
  { id: '35cl_framboise', name: 'Kombucha Framboise - Hibiscus', format: '35cL', packing: 'Carton de 12', priceHT: 22.80, available: true, color: '#F2B9B3', flavor: 'framboise' },
  { id: '35cl_cola', name: 'Kombucha Cola - Chaï', format: '35cL', packing: 'Carton de 12', priceHT: 24.00, available: true, color: '#D4BFA7', flavor: 'cola' },
];

// Liste des comptes clients connus et synchronisés avec Easybeer
const INITIAL_CLIENTS = [
  { id: 'cli_biocoop', name: 'Biocoop Épicerie Verte', codeEasybeer: 'C00104', type: 'GMS', delivery: 'direct', franco: 250, email: 'contact@biocoop-verte.fr', address: '12 Rue des Alouettes, Nantes' },
  { id: 'cli_chope', name: 'Le Bar de la Chope', codeEasybeer: 'C00215', type: 'CHR', delivery: 'carrier', franco: 150, email: 'contact@lachope.fr', address: '45 Place de la République, Angers' },
  { id: 'cli_fine', name: 'L\'Épicerie Fine du Centre', codeEasybeer: 'C00302', type: 'CHR', delivery: 'direct', franco: 150, email: 'epicerie.centre@gmail.com', address: '8 Rue de la Paix, Saint-Nazaire' },
  { id: 'cli_asso', name: 'Festival Brasse-Temps', codeEasybeer: 'C00489', type: 'Evénement', delivery: 'carrier', franco: 400, email: 'bureau@brassetemps.org', address: 'Hippodrome de Pornichet' },
];

// Commandes initiales simulées en attente pour illustrer l'export Easybeer
const INITIAL_ORDERS = [
  {
    id: 'CMD-9824',
    client: INITIAL_CLIENTS[0],
    date: '2026-06-12T10:14:00.000Z',
    items: [
      { productId: '1l_pomme', quantity: 4, priceHT: 18.90 },
      { productId: '1l_gingembre', quantity: 6, priceHT: 19.50 },
      { productId: '35cl_framboise', quantity: 5, priceHT: 22.80 }
    ],
    comment: 'Livraison le matin s\'il vous plaît, accès par la ruelle arrière.',
    subtotal: 306.60,
    deliveryFee: 0,
    totalTTC: 323.46, // 5.5% TVA
    easybeerSynced: false
  },
  {
    id: 'CMD-9825',
    client: INITIAL_CLIENTS[1],
    date: '2026-06-13T16:32:00.000Z',
    items: [
      { productId: '35cl_gingembre', quantity: 3, priceHT: 22.80 },
      { productId: '35cl_cola', quantity: 2, priceHT: 24.00 }
    ],
    comment: 'Merci d\'étiqueter dluo visible.',
    subtotal: 116.40,
    deliveryFee: 18.00, // Sous le franco de 150
    totalTTC: 141.80, // (116.4 + 18) * 1.055
    easybeerSynced: false
  }
];

// Flacon stylisé dessiné dynamiquement en SVG selon les saveurs
const BottleIcon = ({ color, format }) => {
  const isLarge = format === '1L';
  return (
    <svg 
      viewBox="0 0 100 200" 
      className={`${isLarge ? 'h-24 w-12' : 'h-18 w-10'} transition-transform duration-300 hover:scale-115 filter drop-shadow-md`}
    >
      {/* Capsule */}
      <rect x="42" y="10" width="16" height="10" rx="2" fill="#D97706" />
      {/* Goulot */}
      <path d="M45,20 L55,20 L55,45 L45,45 Z" fill="#8B5A2B" opacity="0.9" />
      {/* Épaules bouteille */}
      <path d="M45,45 Q45,70 25,90 L25,185 Q25,195 35,195 L65,195 Q75,195 75,185 L75,90 Q55,70 55,45 Z" fill="#5C3A21" />
      {/* Liquide à l'intérieur (visible par transparence) */}
      <path d="M28,100 L72,100 L72,183 Q72,190 65,190 L35,190 Q28,190 28,183 Z" fill={color} opacity="0.85" />
      {/* Étiquette Kraft */}
      <rect x="30" y="110" width="40" height="50" rx="3" fill="#F4EAD4" stroke="#D97706" strokeWidth="0.5" />
      <text x="50" y="130" fontSize="8" fontWeight="bold" fill="#451A03" textAnchor="middle">BIO</text>
      <text x="50" y="142" fontSize="6" fill="#78350F" textAnchor="middle" letterSpacing="0.1">KOMBUCHA</text>
      <text x="50" y="152" fontSize="7" fontWeight="black" fill="#D97706" textAnchor="middle">{format}</text>
    </svg>
  );
};


export default function App() {
  const [activeTab, setActiveTab] = useState('client'); // 'client' | 'admin' | 'clients-list'
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const [clients, setClients] = useState(INITIAL_CLIENTS);
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [selectedClient, setSelectedClient] = useState(INITIAL_CLIENTS[0]);
  const [cart, setCart] = useState({}); // { productId: quantity }
  const [comment, setComment] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [toasts, setToasts] = useState([]);
  const [loginEmail, setLoginEmail] = useState(INITIAL_CLIENTS[0].email);
  const [isLoggedIn, setIsLoggedIn] = useState(true);

  // Nouvel état pour l'encodage de client par l'admin
  const [newClient, setNewClient] = useState({
    name: '',
    codeEasybeer: 'C' + Math.floor(10000 + Math.random() * 90000),
    type: 'GMS',
    delivery: 'direct',
    franco: 150,
    email: '',
    address: ''
  });

  // Fonction pour afficher des toasts de retour utilisateur
  const triggerToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };


  // Calculs du panier en cours
  const cartSummary = useMemo(() => {
    let subtotalHT = 0;
    Object.entries(cart).forEach(([prodId, qty]) => {
      const product = products.find(p => p.id === prodId);
      if (product && qty > 0) {
        subtotalHT += product.priceHT * qty;
      }
    });

    const franco = selectedClient?.franco || 150;
    const reachedFranco = subtotalHT >= franco;
    const deliveryFee = subtotalHT === 0 ? 0 : (reachedFranco ? 0 : 25.00);
    const amountToFranco = Math.max(0, franco - subtotalHT);
    const tva = (subtotalHT + deliveryFee) * 0.055; // TVA réduite à 5.5% pour le Kombucha en France
    const totalTTC = subtotalHT + deliveryFee + tva;

    return {
      subtotalHT,
      reachedFranco,
      deliveryFee,
      amountToFranco,
      tva,
      totalTTC,
    };
  }, [cart, products, selectedClient]);

  // Ajouter / Enlever des articles au panier
  const updateCartQuantity = (productId, change) => {
    const product = products.find(p => p.id === productId);
    if (!product || !product.available) return;

    setCart((prev) => {
      const currentQty = prev[productId] || 0;
      const newQty = Math.max(0, currentQty + change);
      if (newQty === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: newQty };
    });
  };


  const handlePlaceOrder = () => {
    if (cartSummary.subtotalHT === 0) {
      triggerToast("Votre panier est vide.", "error");
      return;
    }
    setShowConfirmModal(true);
  };

  const confirmOrder = () => {
    const newOrder = {
      id: `CMD-${Math.floor(1000 + Math.random() * 9000)}`,
      client: selectedClient,
      date: new Date().toISOString(),
      items: Object.entries(cart).map(([productId, quantity]) => {
        const prod = products.find(p => p.id === productId);
        return {
          productId,
          quantity,
          priceHT: prod.priceHT,
        };
      }),
      comment: comment,
      subtotal: cartSummary.subtotalHT,
      deliveryFee: cartSummary.deliveryFee,
      totalTTC: cartSummary.totalTTC,
      easybeerSynced: false
    };

    setOrders((prev) => [newOrder, ...prev]);
    setCart({});
    setComment('');
    setShowConfirmModal(false);
    triggerToast("Commande validée avec succès ! Transmise au backoffice.", "success");
  };


  const generateEasybeerCSV = () => {
    // Filtrer les commandes non synchronisées
    const unsynced = orders.filter(o => !o.easybeerSynced);
    if (unsynced.length === 0) {
      triggerToast("Aucune nouvelle commande à exporter vers Easybeer !", "info");
      return;
    }

    // Entête du CSV standard attendu par Easybeer (selon structure classique ERP)
    let csv = "ID_COMMANDE;CODE_CLIENT_EASYBEER;NOM_COMMERCE;DATE_CMD;MODE_LIVRAISON;SKU_PRODUIT;QUANTITE;PRIX_UNITAIRE_HT;FRAIS_PORT_HT;COMMENTAIRE\n";
    
    unsynced.forEach(order => {
      order.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        csv += `${order.id};${order.client.codeEasybeer};"${order.client.name}";${order.date.split('T')[0]};${order.client.delivery.toUpperCase()};${item.productId};${item.quantity};${item.priceHT.toFixed(2)};${order.deliveryFee.toFixed(2)};"${order.comment || ''}"\n`;
      });
    });

    setCsvContent(csv);
    setShowCSVModal(true);
  };

  const markAllAsSynced = () => {
    setOrders((prev) => prev.map(o => ({ ...o, easybeerSynced: true })));
    setShowCSVModal(false);
    triggerToast("Commandes marquées comme 'Synchronisées' dans Easybeer !", "success");
  };

  const downloadCSVFile = () => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `import_easybeer_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Nouvelle fonction pour ajouter un client et générer son lien unique d'invitation
  const handleCreateClient = (e) => {
    e.preventDefault();
    if (!newClient.name || !newClient.email || !newClient.address) {
      triggerToast("Veuillez renseigner au moins le nom, l'email et l'adresse.", "error");
      return;
    }

    const clientId = `cli_${Date.now()}`;
    const created = {
      id: clientId,
      name: newClient.name,
      codeEasybeer: newClient.codeEasybeer || `C${Math.floor(10000 + Math.random() * 90000)}`,
      type: newClient.type,
      delivery: newClient.delivery,
      franco: parseFloat(newClient.franco) || 150,
      email: newClient.email,
      address: newClient.address
    };

    setClients((prev) => [...prev, created]);
    
    // Reset form
    setNewClient({
      name: '',
      codeEasybeer: 'C' + Math.floor(10000 + Math.random() * 90000),
      type: 'GMS',
      delivery: 'direct',
      franco: 150,
      email: '',
      address: ''
    });

    triggerToast(`Client "${created.name}" créé avec succès !`, "success");
  };

  // Générateur de lien d'invitation simulé
  const getClientInvitationLink = (client) => {
    return `https://kombucha-b2b.fr/connexion-directe?token=${client.id}`;
  };

  const handleCopyLink = (client) => {
    const link = getClientInvitationLink(client);
    navigator.clipboard.writeText(link);
    triggerToast(`Lien copié pour ${client.name} !`, "success");
  };

  const handleSimulateClientLogin = (client) => {
    setSelectedClient(client);
    setLoginEmail(client.email);
    setIsLoggedIn(true);
    setCart({});
    setActiveTab('client');
    triggerToast(`Connexion automatique simulée en tant que : ${client.name}`, "info");
  };


  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-sans flex flex-col antialiased">
      {/* Barre de contrôle du Prototype en haut */}
      <div className="bg-amber-950 text-stone-100 px-4 py-3 shadow-md flex flex-wrap items-center justify-between gap-3 border-b border-amber-800">
        <div className="flex items-center gap-2">
          <span className="bg-amber-500 text-amber-950 font-bold px-2 py-0.5 rounded text-xs">PROTOTYPE INTERACTIF</span>
          <h1 className="font-semibold text-sm tracking-wide">B2B Kombucha & Intégration Easybeer</h1>
        </div>
        
        <div className="flex items-center gap-1 bg-amber-900 rounded-lg p-1 text-xs">
          <button 
            onClick={() => { setActiveTab('client'); setIsLoggedIn(true); }}
            className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeTab === 'client' ? 'bg-amber-700 text-white shadow' : 'hover:bg-amber-800/50 text-stone-300'}`}
          >
            📱 Espace Client Pro
          </button>
          <button 
            onClick={() => setActiveTab('admin')}
            className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeTab === 'admin' ? 'bg-amber-700 text-white shadow' : 'hover:bg-amber-800/50 text-stone-300'}`}
          >
            ⚙️ Suivi & Commandes (Admin)
          </button>
          <button 
            onClick={() => setActiveTab('clients-list')}
            className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${activeTab === 'clients-list' ? 'bg-amber-700 text-white shadow' : 'hover:bg-amber-800/50 text-stone-300'}`}
          >
            👥 Fichier Clients & Invitations
          </button>
        </div>
      </div>

      {/* Notifications Toasts */}
      <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div 
            key={t.id} 
            className={`p-3 rounded-lg shadow-lg border text-sm font-medium flex items-center justify-between gap-3 transform translate-y-0 transition-all duration-300 ${
              t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 
              t.type === 'info' ? 'bg-blue-50 border-blue-200 text-blue-800' : 
              'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <span>{t.message}</span>
            <button onClick={() => setToasts((prev) => prev.filter((to) => to.id !== t.id))} className="text-stone-400 hover:text-stone-600">×</button>
          </div>
        ))}
      </div>

      {/* Rendu dynamique basé sur l'onglet actif */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 md:py-8">
        
        {/* ==================== ONGLET CLIENT B2B ==================== */}
        {activeTab === 'client' && (
          <div>
            {!isLoggedIn ? (
              /* Simulation de l'écran de Login de l'App B2B Client */
              <div className="max-w-md mx-auto my-12 bg-white rounded-2xl shadow-xl border border-stone-100 overflow-hidden">
                <div className="bg-emerald-850 text-white p-6 text-center">
                  <div className="w-16 h-16 bg-emerald-700/50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-8 h-8 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold">Kombucha B2B Portal</h2>
                  <p className="text-emerald-100 text-xs mt-1">Espace sécurisé de commande grossiste</p>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Sélectionner un client de test</label>
                    <select 
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      value={selectedClient?.id || ''}
                      onChange={(e) => {
                        const cli = clients.find(c => c.id === e.target.value);
                        setSelectedClient(cli);
                        setLoginEmail(cli ? cli.email : '');
                      }}
                    >
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.type} — Franco {c.franco}€)</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Identifiant professionnel</label>
                    <input 
                      type="email" 
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm"
                      placeholder="nom@commerce.fr"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Mot de passe</label>
                    <input 
                      type="password" 
                      value="••••••••••••" 
                      disabled 
                      className="w-full bg-stone-100 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-400"
                    />
                  </div>

                  <button 
                    onClick={() => {
                      setIsLoggedIn(true);
                      setCart({});
                      triggerToast(`Connecté en tant que ${selectedClient?.name || 'Client'}`);
                    }}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-medium py-2.5 rounded-lg transition text-sm shadow-md"
                  >
                    Se connecter
                  </button>

                  <div className="text-center pt-2">
                    <a href="#" className="text-stone-400 hover:text-stone-600 text-xs underline">Besoin d'aide ? Mot de passe oublié ?</a>
                  </div>
                </div>
              </div>
            ) : (
              /* Écran Principal de Commande B2B */
              <div className="space-y-6">
                
                {/* En-tête de Session Client et Rappel Franco */}
                <div className="bg-white rounded-xl shadow-sm border border-stone-200/80 p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full text-xs">
                        Connecté
                      </span>
                      <h2 className="text-xl font-bold text-stone-900">{selectedClient?.name}</h2>
                    </div>
                    <p className="text-stone-500 text-xs flex flex-wrap gap-x-4 gap-y-1">
                      <span>📍 {selectedClient?.address}</span>
                      <span>• Type : <strong>{selectedClient?.type}</strong></span>
                      <span>• Mode : <strong className="text-amber-700">{selectedClient?.delivery === 'direct' ? 'Livraison directe par nos soins' : 'Transporteur indépendant'}</strong></span>
                    </p>
                  </div>
                  
                  <button 
                    onClick={() => { setIsLoggedIn(false); triggerToast("Déconnecté"); }}
                    className="text-stone-400 hover:text-red-600 text-xs border border-stone-200 px-3 py-1.5 rounded-lg hover:bg-stone-50 transition"
                  >
                    Déconnexion de l'espace pro
                  </button>
                </div>

                {/* Grille Principale : Catalogue vs Panier */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* CATALOGUE DE PRODUITS (Prend 2 colonnes) */}
                  <div className="lg:col-span-2 space-y-6">
                    
                    {/* Filtre de format rapide */}
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-stone-900">Catalogue d'embouteillage</h3>
                      <p className="text-xs text-stone-500">Mise à jour en direct avec l'atelier</p>
                    </div>

                    {/* SECTION : FORMAT 1L */}
                    <div className="space-y-3">
                      <div className="border-b border-stone-200 pb-1">
                        <h4 className="font-bold text-stone-700 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                          Format 1 Litre <span className="text-xs font-normal text-stone-400">(Colisage par Carton de 6 bouteilles)</span>
                        </h4>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {products.filter(p => p.format === '1L').map(product => (
                          <div 
                            key={product.id} 
                            className={`bg-white rounded-xl border p-4 flex gap-4 transition-all relative overflow-hidden ${
                              product.available ? 'border-stone-200 hover:border-emerald-300 hover:shadow-md' : 'border-stone-100 opacity-60 bg-stone-50'
                            }`}
                          >
                            <div className="flex-shrink-0 bg-stone-50 p-2 rounded-lg flex items-center justify-center">
                              <BottleIcon color={product.color} format={product.format} />
                            </div>

                            <div className="flex-1 flex flex-col justify-between">
                              <div>
                                <h5 className="font-bold text-stone-900 text-sm leading-snug">{product.name}</h5>
                                <p className="text-stone-400 text-xs mt-0.5">{product.packing}</p>
                              </div>

                              <div className="mt-3 flex items-center justify-between">
                                <div>
                                  <span className="text-base font-extrabold text-stone-800">{product.priceHT.toFixed(2)} €</span>
                                  <span className="text-[10px] text-stone-400 block">HT / Carton</span>
                                </div>

                                {product.available ? (
                                  <div className="flex items-center bg-stone-100 rounded-lg p-0.5 border border-stone-200">
                                    <button 
                                      onClick={() => updateCartQuantity(product.id, -1)}
                                      className="w-8 h-8 rounded-md text-stone-600 hover:bg-white flex items-center justify-center font-bold text-lg active:scale-95 transition"
                                    >
                                      -
                                    </button>
                                    <span className="w-8 text-center text-sm font-bold text-stone-800">
                                      {cart[product.id] || 0}
                                    </span>
                                    <button 
                                      onClick={() => updateCartQuantity(product.id, 1)}
                                      className="w-8 h-8 rounded-md text-stone-600 hover:bg-white flex items-center justify-center font-bold text-lg active:scale-95 transition"
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <span className="bg-red-50 text-red-600 border border-red-100 text-[10px] font-bold px-2 py-1 rounded">
                                    Victime de son succès
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* SECTION : FORMAT 35CL */}
                    <div className="space-y-3 pt-4">
                      <div className="border-b border-stone-200 pb-1">
                        <h4 className="font-bold text-stone-700 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-600"></span>
                          Format Individuel 35cL <span className="text-xs font-normal text-stone-400">(Nouveau Colisage par Carton de 12 bouteilles)</span>
                        </h4>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {products.filter(p => p.format === '35cL').map(product => (
                          <div 
                            key={product.id} 
                            className={`bg-white rounded-xl border p-4 flex gap-4 transition-all relative overflow-hidden ${
                              product.available ? 'border-stone-200 hover:border-amber-300 hover:shadow-md' : 'border-stone-100 opacity-60 bg-stone-50'
                            }`}
                          >
                            <div className="flex-shrink-0 bg-stone-50 p-2 rounded-lg flex items-center justify-center">
                              <BottleIcon color={product.color} format={product.format} />
                            </div>

                            <div className="flex-1 flex flex-col justify-between">
                              <div>
                                <h5 className="font-bold text-stone-900 text-sm leading-snug">{product.name}</h5>
                                <p className="text-stone-400 text-xs mt-0.5">{product.packing}</p>
                              </div>

                              <div className="mt-3 flex items-center justify-between">
                                <div>
                                  <span className="text-base font-extrabold text-stone-800">{product.priceHT.toFixed(2)} €</span>
                                  <span className="text-[10px] text-stone-400 block">HT / Carton</span>
                                </div>

                                {product.available ? (
                                  <div className="flex items-center bg-stone-100 rounded-lg p-0.5 border border-stone-200">
                                    <button 
                                      onClick={() => updateCartQuantity(product.id, -1)}
                                      className="w-8 h-8 rounded-md text-stone-600 hover:bg-white flex items-center justify-center font-bold text-lg active:scale-95 transition"
                                    >
                                      -
                                    </button>
                                    <span className="w-8 text-center text-sm font-bold text-stone-800">
                                      {cart[product.id] || 0}
                                    </span>
                                    <button 
                                      onClick={() => updateCartQuantity(product.id, 1)}
                                      className="w-8 h-8 rounded-md text-stone-600 hover:bg-white flex items-center justify-center font-bold text-lg active:scale-95 transition"
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : (
                                  <span className="bg-red-50 text-red-600 border border-red-100 text-[10px] font-bold px-2 py-1 rounded">
                                    En rupture
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>

                  {/* PANIER & CADRAGE FINANCIER (Prend 1 colonne) */}
                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 sticky top-24 space-y-6">
                      <div className="border-b border-stone-100 pb-3">
                        <h3 className="text-lg font-bold text-stone-950">Récapitulatif de commande</h3>
                        <p className="text-stone-400 text-xs">Ajustez vos quantités si nécessaire</p>
                      </div>

                      {/* Jauge Dynamique de Franco */}
                      <div className="space-y-2 bg-stone-50 p-4 rounded-xl border border-stone-100">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-stone-500">Objectif Franco de Port :</span>
                          <span className="text-emerald-700 font-bold">{(selectedClient?.franco || 150).toFixed(2)} € HT</span>
                        </div>

                        {/* Barre de progression visuelle */}
                        <div className="w-full bg-stone-200 rounded-full h-3 overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 rounded-full ${
                              cartSummary.reachedFranco ? 'bg-emerald-600' : 'bg-amber-500'
                            }`}
                            style={{ width: `${Math.min(100, (cartSummary.subtotalHT / (selectedClient?.franco || 150)) * 100)}%` }}
                          ></div>
                        </div>

                        <div className="text-[11px] leading-relaxed">
                          {cartSummary.reachedFranco ? (
                            <span className="text-emerald-700 font-bold flex items-center gap-1">
                              🎉 Franco atteint ! Livraison gratuite activée.
                            </span>
                          ) : (
                            <span className="text-stone-500">
                              Encore <strong className="text-amber-700 font-bold">{cartSummary.amountToFranco.toFixed(2)} € HT</strong> pour économiser les <strong className="font-semibold">25,00 €</strong> de frais de port.
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Liste simplifiée des articles dans le panier */}
                      <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                        {Object.keys(cart).length === 0 ? (
                          <div className="text-center py-6 text-stone-400 text-xs">
                            Aucun carton dans le panier pour le moment.
                          </div>
                        ) : (
                          Object.entries(cart).map(([productId, qty]) => {
                            const prod = products.find(p => p.id === productId);
                            if (!prod) return null;
                            return (
                              <div key={productId} className="flex justify-between items-center text-xs">
                                <div className="flex-1 min-w-0 pr-2">
                                  <p className="font-semibold text-stone-800 truncate">{prod.name}</p>
                                  <p className="text-stone-400 text-[10px]">{qty} x {prod.packing} @ {prod.priceHT.toFixed(2)}€</p>
                                </div>
                                <span className="font-bold text-stone-800">{(prod.priceHT * qty).toFixed(2)} € HT</span>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Ventilation financière de la V1 */}
                      <div className="border-t border-stone-100 pt-4 space-y-2 text-xs">
                        <div className="flex justify-between text-stone-600">
                          <span>Sous-total HT</span>
                          <span>{cartSummary.subtotalHT.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between text-stone-600">
                          <span>
                            Frais de livraison ({selectedClient?.delivery === 'direct' ? 'Tournée' : 'Transporteur'})
                          </span>
                          <span>
                            {cartSummary.deliveryFee === 0 ? (
                              <span className="text-emerald-700 font-bold">Gratuit</span>
                            ) : (
                              `${cartSummary.deliveryFee.toFixed(2)} €`
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between text-stone-400 text-[10px] italic">
                          <span>Estimation Droits d'accise + TVA 5.5%</span>
                          <span>{cartSummary.tva.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-stone-900 border-t border-stone-100 pt-2">
                          <span>Total Général Est. (TTC)</span>
                          <span className="text-emerald-800">{cartSummary.totalTTC.toFixed(2)} €</span>
                        </div>
                      </div>

                      {/* Commentaire de livraison */}
                      <div className="space-y-1">
                        <label className="text-stone-500 font-semibold text-[10px] uppercase tracking-wider block">Instruction ou Commentaire de livraison</label>
                        <textarea 
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Ex: besoin de PLV, appeler 15 min avant..."
                          className="w-full bg-stone-50 border border-stone-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 h-16 resize-none"
                        />
                      </div>

                      <button 
                        onClick={handlePlaceOrder}
                        disabled={cartSummary.subtotalHT === 0}
                        className={`w-full py-3 rounded-xl font-bold text-sm tracking-wide transition flex items-center justify-center gap-2 shadow-sm ${
                          cartSummary.subtotalHT === 0 
                            ? 'bg-stone-100 text-stone-400 cursor-not-allowed' 
                            : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        Valider ma commande définitive
                      </button>
                    </div>
                  </div>

                </div>

              </div>
            )}
          </div>
        )}

        {/* ==================== ONGLET ADMIN BRASSEUR ==================== */}
        {activeTab === 'admin' && (
          <div className="space-y-6">
            
            {/* Header d'administration */}
            <div className="bg-amber-900/10 border border-amber-900/20 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-amber-950">Atelier d'Administration</h2>
                <p className="text-amber-800 text-xs mt-1">Gérez le catalogue instantané, consultez les commandes reçues et exportez vers Easybeer.</p>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={generateEasybeerCSV}
                  className="bg-amber-800 hover:bg-amber-900 text-white font-semibold px-4 py-2.5 rounded-xl transition text-xs shadow-md flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Générer le Pont CSV Easybeer
                </button>
              </div>
            </div>

            {/* Grille de gestion */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* SECTION : COMMANDES REÇUES (Prend 2 colonnes) */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold text-stone-900">Commandes en attente de traitement</h3>
                  <span className="bg-amber-100 text-amber-800 font-bold px-2.5 py-1 rounded-full text-[10px]">
                    {orders.filter(o => !o.easybeerSynced).length} Non-transérées
                  </span>
                </div>

                <div className="space-y-3">
                  {orders.map((order) => (
                    <div key={order.id} className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
                      
                      {/* Entête commande */}
                      <div className="flex justify-between items-start border-b border-stone-100 pb-3 flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-stone-900">{order.id}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              order.easybeerSynced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {order.easybeerSynced ? 'Synchronisé Easybeer' : 'Prêt à Exporter'}
                            </span>
                          </div>
                          <p className="text-stone-400 text-[11px] mt-0.5">Le {new Date(order.date).toLocaleString('fr-FR')}</p>
                        </div>

                        <div className="text-right">
                          <p className="font-extrabold text-stone-900 text-base">{order.totalTTC.toFixed(2)} € TTC</p>
                          <p className="text-stone-400 text-[10px]">({order.subtotal.toFixed(2)} € HT + {order.deliveryFee}€ Port)</p>
                        </div>
                      </div>

                      {/* Contenu et Détails de la Commande */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div>
                          <p className="text-stone-400 font-semibold text-[10px] uppercase">Client & Logistique</p>
                          <p className="font-bold text-stone-800 mt-0.5">{order.client?.name} ({order.client?.codeEasybeer})</p>
                          <p className="text-stone-500 text-[11px] mt-0.5">
                            Mode : <span className="underline">{order.client?.delivery === 'direct' ? 'Tournée Directe' : 'Transporteur'}</span> 
                            {order.client?.delivery === 'direct' && ' (Franco atteint)'}
                          </p>
                        </div>

                        <div>
                          <p className="text-stone-400 font-semibold text-[10px] uppercase">Articles commandés</p>
                          <div className="space-y-1 mt-1 max-h-24 overflow-y-auto">
                            {order.items.map((item, idx) => {
                              const prod = products.find(p => p.id === item.productId);
                              return (
                                <p key={idx} className="text-stone-700 text-[11px] flex justify-between">
                                  <span>• {item.quantity}x {prod ? prod.name : item.productId} ({prod ? prod.format : ''})</span>
                                  <span className="font-medium">{(item.quantity * item.priceHT).toFixed(2)} € HT</span>
                                </p>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {order.comment && (
                        <div className="bg-stone-50 border border-stone-100 p-2.5 rounded-lg text-xs text-stone-600">
                          <strong className="text-stone-500">Note client :</strong> "{order.comment}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION : GESTION DIRECTE DU CATALOGUE (On/Off) */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-stone-900">Ruptures & Disponibilités</h3>
                <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm space-y-4">
                  <p className="text-xs text-stone-500 leading-relaxed">
                    Tentez l'expérience : désactivez un produit ici. Il disparaîtra ou s'affichera immédiatement en "Rupture" sur l'interface du client.
                  </p>

                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {products.map((product) => (
                      <div key={product.id} className="flex justify-between items-center text-xs border-b border-stone-100 pb-2">
                        <div className="flex-1 min-w-0 pr-2">
                          <span className="font-bold text-stone-800 block truncate">{product.name}</span>
                          <span className="text-stone-400 text-[10px]">{product.format} — {product.packing}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded ${
                            product.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          }`}>
                            {product.available ? 'Actif' : 'Masqué'}
                          </span>
                          
                          {/* Switch toggle On/Off */}
                          <button 
                            onClick={() => {
                              setProducts((prev) => prev.map(p => p.id === product.id ? { ...p, available: !p.available } : p));
                              triggerToast(`${product.name} mis à jour`);
                            }}
                            className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                              product.available ? 'bg-emerald-600' : 'bg-stone-300'
                            }`}
                          >
                            <div className={`bg-white w-4 h-4 rounded-full shadow transition-transform duration-200 ${
                              product.available ? 'transform translate-x-4' : ''
                            }`}></div>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ==================== ONGLET FICHIER CLIENTS & ENCODAGE ==================== */}
        {activeTab === 'clients-list' && (
          <div className="space-y-6">
            
            {/* Header de gestion des clients */}
            <div className="bg-emerald-900/10 border border-emerald-900/20 rounded-2xl p-6">
              <h2 className="text-2xl font-bold text-emerald-950">Fichier Clients & Invitations Pro</h2>
              <p className="text-emerald-800 text-xs mt-1">
                Gérez vos comptes clients B2B, encodez de nouveaux commerces et générez des liens d'activation directs pour leur éviter l'oubli de mot de passe.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* FORMULAIRE D'ENCODAGE DE CLIENT */}
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                  <span className="w-2 h-6 bg-emerald-700 rounded-full"></span>
                  Ajouter un nouveau client
                </h3>
                <p className="text-stone-500 text-xs">
                  Saisissez les informations de votre client pro pour générer son lien unique.
                </p>

                <form onSubmit={handleCreateClient} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-stone-500 font-semibold mb-1">Nom du commerce *</label>
                    <input 
                      type="text" 
                      required
                      value={newClient.name}
                      onChange={(e) => setNewClient({...newClient, name: e.target.value})}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                      placeholder="ex: Biocoop Nantes Centre"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-stone-500 font-semibold mb-1">Code Easybeer</label>
                      <input 
                        type="text" 
                        value={newClient.codeEasybeer}
                        onChange={(e) => setNewClient({...newClient, codeEasybeer: e.target.value})}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                        placeholder="ex: C00350"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-500 font-semibold mb-1">Email de contact *</label>
                      <input 
                        type="email" 
                        required
                        value={newClient.email}
                        onChange={(e) => setNewClient({...newClient, email: e.target.value})}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                        placeholder="contact@magasin.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-stone-500 font-semibold mb-1">Type de commerce</label>
                      <select 
                        value={newClient.type}
                        onChange={(e) => {
                          const val = e.target.value;
                          let defaultFranco = 150;
                          if (val === 'GMS') defaultFranco = 250;
                          if (val === 'Evénement') defaultFranco = 400;
                          setNewClient({...newClient, type: val, franco: defaultFranco});
                        }}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                      >
                        <option value="GMS">GMS (Grande surface)</option>
                        <option value="CHR">CHR (Café / Hôtel / Resto)</option>
                        <option value="Evénement">Événementiel</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-stone-500 font-semibold mb-1">Mode de livraison</label>
                      <select 
                        value={newClient.delivery}
                        onChange={(e) => setNewClient({...newClient, delivery: e.target.value})}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                      >
                        <option value="direct">Tournée Directe</option>
                        <option value="carrier">Transporteur</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-stone-500 font-semibold mb-1">Franco de port (€ HT)</label>
                      <input 
                        type="number" 
                        value={newClient.franco}
                        onChange={(e) => setNewClient({...newClient, franco: e.target.value})}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                        placeholder="150"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-stone-500 font-semibold mb-1">Adresse de livraison *</label>
                    <input 
                      type="text" 
                      required
                      value={newClient.address}
                      onChange={(e) => setNewClient({...newClient, address: e.target.value})}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 outline-none"
                      placeholder="12 rue de la Brasserie, Nantes"
                    />
                  </div>

                  <button 
                    type="submit"
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl transition text-xs shadow-sm mt-2"
                  >
                    Créer le compte et générer le lien
                  </button>
                </form>
              </div>

              {/* LISTE DES CLIENTS ET LIENS GÉNÉRÉS */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="text-lg font-bold text-stone-900 flex items-center justify-between">
                  <span>Commerces enregistrés ({clients.length})</span>
                </h3>

                <div className="space-y-3">
                  {clients.map((client) => {
                    const invitationLink = getClientInvitationLink(client);
                    return (
                      <div key={client.id} className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm space-y-3 flex flex-col justify-between">
                        
                        {/* Infos client */}
                        <div className="flex justify-between items-start flex-wrap gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-stone-900 text-sm">{client.name}</h4>
                              <span className="bg-stone-100 text-stone-600 font-bold px-2 py-0.5 rounded text-[10px]">
                                {client.codeEasybeer}
                              </span>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                client.type === 'GMS' ? 'bg-blue-50 text-blue-700' :
                                client.type === 'CHR' ? 'bg-amber-50 text-amber-700' :
                                'bg-purple-50 text-purple-700'
                              }`}>
                                {client.type}
                              </span>
                            </div>
                            <p className="text-stone-400 text-[11px] mt-1">📍 {client.address} • ✉️ {client.email}</p>
                          </div>

                          <div className="text-right text-[11px] text-stone-500">
                            <p>Livraison : <strong className="text-stone-700">{client.delivery === 'direct' ? 'Tournée' : 'Transporteur'}</strong></p>
                            <p>Franco : <strong className="text-emerald-700">{client.franco} € HT</strong></p>
                          </div>
                        </div>

                        {/* Lien d'inscription / Connexion directe */}
                        <div className="bg-stone-50 border border-stone-100 p-3 rounded-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] text-stone-400 block font-semibold uppercase tracking-wider">Lien d'invitation à envoyer au client :</span>
                            <span className="text-emerald-800 font-mono text-[11px] block truncate select-all">{invitationLink}</span>
                          </div>

                          <div className="flex gap-2 shrink-0">
                            <button 
                              onClick={() => handleCopyLink(client)}
                              className="bg-white hover:bg-stone-100 border border-stone-200 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 text-stone-700 active:scale-95 transition"
                              title="Copier le lien"
                            >
                              📋 Copier
                            </button>
                            <button 
                              onClick={() => handleSimulateClientLogin(client)}
                              className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 shadow-sm active:scale-95 transition"
                              title="Simuler la connexion de ce client"
                            >
                              🔌 Tester la connexion
                            </button>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* ==================== CONFIRMATION MODAL CLIENT (Ferme) ==================== */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-100 space-y-4 animate-scaleUp">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-stone-900">Confirmer la commande ?</h3>
              <p className="text-stone-500 text-xs">
                Cette commande est ferme et **non annulable** conformément aux conditions de tournée logistique.
              </p>
            </div>

            <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-stone-500">Client :</span>
                <span className="font-bold text-stone-800">{selectedClient.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Sous-total HT :</span>
                <span className="font-bold text-stone-800">{cartSummary.subtotalHT.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Livraison :</span>
                <span className="font-bold text-stone-800">{cartSummary.deliveryFee === 0 ? 'Gratuite' : `${cartSummary.deliveryFee.toFixed(2)} €`}</span>
              </div>
              <div className="flex justify-between border-t border-stone-200/80 pt-1.5 font-bold">
                <span className="text-stone-700">Total estimé TTC :</span>
                <span className="text-emerald-800">{cartSummary.totalTTC.toFixed(2)} €</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-600 font-bold py-2.5 rounded-xl transition text-xs"
              >
                Annuler
              </button>
              <button 
                onClick={confirmOrder}
                className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 rounded-xl transition text-xs"
              >
                Oui, je commande
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL DE TRANSFERT / EXP CSV EASYBEER ==================== */}
      {showCSVModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-stone-100 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-stone-900">Génération du fichier passif Easybeer</h3>
                <p className="text-stone-500 text-xs mt-0.5">Glissez-déposez ce fichier directement dans le module d'import de votre interface Easybeer.</p>
              </div>
              <button onClick={() => setShowCSVModal(false)} className="text-stone-400 hover:text-stone-600 font-bold text-lg">×</button>
            </div>

            {/* Afficheur de code CSV généré */}
            <div className="relative">
              <pre className="bg-stone-900 text-stone-200 p-4 rounded-xl text-[10px] overflow-x-auto max-h-64 font-mono leading-relaxed">
                {csvContent}
              </pre>
            </div>

            <div className="flex flex-wrap gap-3 justify-end pt-2">
              <button 
                onClick={downloadCSVFile}
                className="bg-amber-800 hover:bg-amber-900 text-white font-bold px-4 py-2.5 rounded-xl transition text-xs flex items-center gap-1.5"
              >
                📥 Télécharger le fichier .CSV
              </button>
              
              <button 
                onClick={markAllAsSynced}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2.5 rounded-xl transition text-xs"
              >
                Marquer comme synchronisées
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pied de page du prototype */}
      <footer className="border-t border-stone-200 bg-white py-4 text-center text-xs text-stone-400">
        <p>Développé pour la Brasserie de Kombucha • Système de commande B2B V1</p>
      </footer>
    </div>
  );
}