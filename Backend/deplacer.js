async function deplacer(idVaisseau, x, y) {
  return apiPost(`/equipes/${TEAM_ID}/vaisseaux/${idVaisseau}/demander-action`, {
    action: "DEPLACEMENT",
    coord_x: x,
    coord_y: y
  });
}