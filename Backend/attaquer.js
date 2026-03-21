async function attaquer(idVaisseau, x, y) {
  return apiPost(`/equipes/${TEAM_ID}/vaisseaux/${idVaisseau}/demander-action`, {
    action: "ATTAQUER",
    coord_x: x,
    coord_y: y
  });
}