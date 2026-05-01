# Tuya Web - Migration vers SmartLife API

## ⚠️ CHANGEMENT MAJEUR - Version 2.0.0

Cette version migre l'ancienne API Home Assistant (obsolète) vers la nouvelle API SmartLife Cloud. Plusieurs changements importants ont été apportés :

### Changements importants

1. **Support SmartLife uniquement** : Ce plugin ne supporte désormais que les comptes **Smart Life**. Les utilisateurs de Tuya Smart ou Jinvoo Smart devront :
   - Migrer leurs comptes et dispositifs vers l'application Smart Life
   - Ou continuer à utiliser la version 1.x du plugin (si l'API fonctionne encore)

2. **Nouveau paramètre `region`** : Remplace l'ancien paramètre `platform`
   - `auto` : Essaie automatiquement toutes les régions (par défaut)
   - `us` : États-Unis
   - `eu` : Europe
   - `in` : Inde

3. **Authentification améliorée** : 
   - Processus d'authentification en 2 étapes
   - Chiffrement RSA du mot de passe
   - Signature HMAC de toutes les requêtes
   - Réauthentification automatique en cas d'expiration de session

4. **Meilleure fiabilité** :
   - Gestion robuste des erreurs avec retry automatique
   - Détection et gestion des erreurs de session
   - Support de multiples endpoints par région

### Nouvelle configuration

```json
{
  "platform": "TuyaWebPlatform",
  "name": "TuyaWebPlatform",
  "options": {
    "username": "your-smartlife-email@example.com",
    "password": "your-password",
    "countryCode": "1",
    "region": "auto",
    "pollingInterval": 600
  }
}
```

### Migration depuis v1.x

1. **Vérifiez que vous utilisez Smart Life** : Connectez-vous à l'application Smart Life avec vos identifiants
2. **Mettez à jour la configuration** :
   - Supprimez le paramètre `platform` 
   - Ajoutez le paramètre `region` (optionnel, défaut: `auto`)
3. **Redémarrez Homebridge**
4. **Vérifiez les logs** pour confirmer l'authentification réussie

### Paramètres de configuration

| Paramètre | Type | Requis | Défaut | Description |
|-----------|------|---------|---------|-------------|
| `username` | string | ✅ | - | Email ou numéro de téléphone Smart Life |
| `password` | string | ✅ | - | Mot de passe Smart Life |
| `countryCode` | string | ✅ | - | Code pays (ex: 1 pour USA, 33 pour France, 44 pour UK) |
| `region` | string | ❌ | `auto` | Région cloud (`auto`, `us`, `eu`, `in`) |
| `pollingInterval` | number | ❌ | - | Intervalle de polling en secondes (minimum 600) |

### Guide de migration des comptes

Si vous utilisez Tuya Smart ou Jinvoo Smart, vous devrez migrer vers Smart Life :

1. Téléchargez l'application **Smart Life** sur votre smartphone
2. Créez un compte avec le même email/numéro et la même région
3. Ajoutez vos dispositifs à Smart Life (ils devraient être détectés automatiquement si déjà configurés)
4. Mettez à jour votre configuration Homebridge avec les nouveaux identifiants

### Problèmes connus

- Les dispositifs doivent être configurés dans l'application Smart Life
- Certains types de dispositifs peuvent ne pas être supportés initialement
- Le mappage des data points peut nécessiter des ajustements

### Support

Si vous rencontrez des problèmes :
1. Vérifiez que vous pouvez vous connecter à l'application Smart Life
2. Vérifiez les logs Homebridge pour plus de détails
3. Ouvrez un issue sur GitHub avec les logs (en masquant les informations sensibles)

### Développement

Cette migration est basée sur l'analyse du projet `homebridge-smartlife-cloud` qui utilise la même API SmartLife Cloud.

---

## Documentation originale

[Le reste de la documentation originale suit ici...]
