# Project TODO

- [x] Définir des limites de traitement et des contrôles anti-SSRF pour les URLs distantes.
- [x] Créer la structure de données des extractions, images et archives générées.
- [x] Concevoir l’interface de saisie de galerie, de prévisualisation et de sélection des images.
- [x] Implémenter l’analyse serveur du HTML et l’extraction des identifiants depuis les balises `a[name]`.
- [x] Résoudre les URL d’images originales à partir des pages associées et des métadonnées de haute résolution.
- [x] Télécharger les images en parallèle avec timeout, limites de taille et remontée des erreurs individuelles.
- [x] Générer une archive ZIP téléchargeable et conserver son emplacement de manière temporaire.
- [x] Afficher la progression, les états de traitement et des messages d’erreur compréhensibles.
- [x] Ajouter des tests unitaires pour l’analyse HTML, les validations d’URL et la sélection des images.
- [x] Vérifier l’interface sur ordinateur et mobile, puis créer le point de restauration final.
- [x] Identifier pourquoi plusieurs entrées de galerie se résolvent vers la même image originale.
- [x] Écarter les URL originales dupliquées avant l’ajout des fichiers dans l’archive ZIP.
- [x] Garantir des noms de fichiers ZIP uniques et ajouter un test de non-régression sur les doublons.
