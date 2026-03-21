async function recolter(idVaisseau, x, y) {
  return apiPost(`/equipes/${TEAM_ID}/vaisseaux/${idVaisseau}/demander-action`, {
    action: "RECOLTER",
    coord_x: x,
    coord_y: y
  });
}